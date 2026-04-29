---
title: "Product Brief: marketpilot-repricer"
status: "complete"
created: "2026-04-28"
updated: "2026-04-28"
inputs:
  - CLAUDE.md
  - RESEARCH.md
  - OUTREACH.md
  - PRICING.md (historical pricing only — superseded)
  - Strategic planning conversation 2026-04-28
  - Web research synthesis (competitive landscape, Mirakl ecosystem trends)
---

# Product Brief: MarketPilot Repricer

## Executive Summary

**MarketPilot Repricer is a self-served repricing SaaS for Iberian sellers on Mirakl-based marketplaces, starting with Worten PT/ES.** The tool monitors competitor prices in real time and automatically adjusts the seller's published price to win 1st place within configurable margin tolerance — and to raise the price toward a ceiling when already winning. It is built downstream of an already-shipped free opportunity report (the *DynamicPriceIdea* repo) which generates polished, branded analyses for prospects and funnels them into the paid product via an embedded CTA leading directly to account creation.

The Iberian Mirakl ecosystem is in a moment of unusual opportunity: Fnac fully exited Mirakl in June 2025, consolidating Portuguese/Spanish marketplace volume on Worten + Phone House. Worten launched Mirakl Ads in July 2025, lifting seller sales attribution by 40 percentage points and pulling fresh SME sellers onto the platform — sellers who will hit the buybox-loss pain within months. Existing repricing tools (Boardfy ~€19/mo sticker with hidden add-ons, Boostmyshop ~€99/mo, Omnia Retail enterprise-only) have no local Portuguese/Spanish presence, no flat-fee transparent pricing, and consistently draw user complaints around speed, silent failures, and per-item configuration tedium.

MarketPilot's wedge is **trust through transparency**: encrypted-at-rest API key vault, dry-run-by-default with informed-consent Go-Live, full audit log of every price change, cooperative model with the seller's existing ERP sync (the tool absorbs external price changes as new baselines rather than fighting them), three-layer write safety (engine tiers + outbound circuit breaker + nightly reconciliation), and a worked-profit-example margin editor that shows the seller exactly what each setting does in their own euros. Pricing is **flat €50/marketplace/month with no setup fee** — every Capterra complaint about competitors (revenue-based fees, hidden add-ons, slow refresh, opaque results) becomes a deliberate counter-positioning.

## The Problem

On Mirakl-based marketplaces — Worten primarily — the seller with the lowest total price (price + shipping) appears as the main listing. **99% of buyers never scroll to see other sellers.** Being in 2nd, 5th, or 7th place is functionally identical: invisible. Pedro's free opportunity reports across real Worten sellers consistently surface the same picture: a typical mid-sized seller has thousands of SKUs in 1st place, but **tens of thousands losing position by cents** — small price gaps that quietly destroy revenue at scale.

How sellers cope today:

- **Manual checks** — owners or operations staff opening Worten daily, scanning rankings, adjusting prices reactively. Impossible at 50k+ SKUs and 24/7 competitive movement.
- **Internal scripts** — a few sophisticated sellers wire their own scrapers or rule engines, fragile and time-consuming to maintain.
- **Existing tools** — Boardfy (Spanish, sticker €19/mo with add-ons inflating real cost), Boostmyshop myPricing (French, ~€99/mo+, MiraklConnect dependency), Omnia Retail (€10k+/yr enterprise tier). No local PT/ES presence, no flat-fee model, and consistent user complaints around silent stalls (up to 2 weeks), 12h refresh delays, per-item min/max/VAT configuration tedium for every marketplace, and tools showing "buybox won" when the seller is actually out of buybox.
- **Nothing** — the largest segment, especially among Portuguese-speaking sellers. Pedro's outreach to ~30 leads consistently surfaces "no automation, just manual checks occasionally" — including from sellers doing meaningful volume (You Get: 8.4k Worten products, 25 marketplaces total, zero pricing automation).

The cost of status quo: real, recurring revenue loss measured in tens of thousands of euros per quarter for any seller doing meaningful volume. Pedro's reports demonstrate the gap concretely with each prospect's own catalog data.

## The Solution

A self-served SaaS where the seller signs up, pastes their Worten shop API key into a single-purpose encrypted form, and lets the tool work — within tolerance bands they control, with full visibility into every action.

**The mechanics:**

- The tool reads competitor prices via Mirakl P11 (verified working on production Worten 2026-04-07) and pushes price updates via Mirakl PRI01 (price-only-safe, confirmed). Direct shop API key — no MiraklConnect dependency.
- Repricing logic is **list_price-anchored percentage tolerance** (not cost-based). The seller's current Worten price is taken as their pricing intent baseline. Floor = `list_price × (1 - max_discount_pct)`. Ceiling = `list_price × (1 + max_increase_pct)`. No CSV upload, no commission/VAT/shipping data entry — the customer's onboarding margin question sets a smart default tolerance calibrated to their reality:

| Customer's stated margin | Default `max_discount_pct` | Notes |
|---|---|---|
| <5% (refurbished, commodity) | 0.5% | Surface warning + recommend Epic 2 cost-CSV when shipped |
| 5-10% (typical electronics) | 1% | |
| 10-15% (mixed retail, beauty) | 2% | |
| 15%+ (premium, fashion) | 3% | |

  Default `max_increase_pct` is 5% globally (no margin-correlated risk on the upside).

- **Tiered scheduling + nightly reconciliation.** Per-SKU classification drives cycle cadence: **Tier 1** (contested, position > 1) every 15 min; **Tier 2a** (just won, position = 1, `last_won_at` < 4h ago) every 15 min — recently-won SKUs are watched as closely as contested because active-repricer markets like Worten can undercut us within minutes of taking 1st; **Tier 2b** (stable winner, position = 1, `last_won_at` ≥ 4h ago) every 30-60 min; **Tier 3** (no competitors) once daily and serves as nightly reconciliation that re-classifies all products and self-heals stale state. Implementation: single cron polls every 5 min, selecting SKUs by per-SKU `tier_cadence_minutes` column — cleaner than per-tier crons and supports per-customer cadence customization in Epic 2 for free. Reduces API call volume ~25-30% on a 50k-SKU catalog vs uniform-cycle, while closing the blind-window failure mode where active competitors undercut a recently-won SKU during a long Tier 2 wait. Provides an explicit decision framework for engine edge cases (tied prices, leader-is-self, all-competitors-above-ceiling, etc. — to be enumerated in PRD).
- **Outbound write circuit breaker.** Independent safety layer on top of tiers: no single repricing cycle pushes more than 20% of catalog SKUs, and no single price push moves a SKU's price by more than 15%. If either threshold trips, the cycle is frozen, the customer is alerted, and a manual review unblocks. This catches engine bugs that tiers wouldn't.
- Both directions are first-class: undercut to win 1st place when behind, raise toward ceiling when already winning. Per channel — Worten PT and Worten ES are repriced independently because the competitive landscapes diverge meaningfully.
- **Cooperative model with the seller's ERP sync.** When an external price change is detected (the seller's ERP overwriting the tool's last push, manual edits, etc.), the tool absorbs the change as the new `list_price` and recomputes from the new baseline. A 40% deviation safety threshold freezes anomalous *inbound* changes (decimal-point ERP bugs) and alerts the customer.
- **Dry-run by default.** Customer reviews simulated repricing output for as long as they want. To go live, they confirm via an informed-consent modal worded conditionally: *"Até **N produtos** poderão ter preços ajustados, dentro da margem de **X%** que configuraram. Os preços são otimizados a cada 15 minutos, sempre dentro da vossa tolerância."* They check the consent box, the cron flips on, and Stripe begins the recurring monthly subscription. **Invoicing for Portuguese SMEs is generated manually by the founder via Moloni** (NIF/IVA-compliant) for each payment until volume justifies API integration.
- **Trust architecture from day 1**: encrypted-at-rest key vault, Supabase Auth + RLS, single-purpose key-entry form (customer's key never visible to founder in plaintext), per-customer-per-channel audit log of every action, pause button, margin editor with **worked profit example** that shows in real euros what each setting does to a representative SKU.

The first dashboard view after onboarding shows the same KPI categories the free report introduced — SKUs in 1st, losing position, exclusive, total catalog value — in a visually consistent family. The dashboard is fully interactive (channel toggle, audit log, margin editor, pause) rather than a UI clone of the static report, but a customer who saw the report recognizes the dashboard as the same product line.

**Acquisition flow.** The free opportunity report's CTA leads directly to account creation (no email gate, no sales call required). Customer onboarding includes a *"How to find your Worten Marketplace API key"* one-page guide, since most prospects already use the Worten Seller Center but haven't generated a key.

**Tagline (working draft, Portuguese — customer-facing, may be revised):**

> *"Vendedores Mirakl perdem 1.º lugar por cêntimos. MarketPilot recupera essas vendas, sem ferramenta a correr-vos com a margem ou com surpresas no preço — local, transparente, e em modo dry-run até decidirem ir ao vivo."*

## What Makes This Different

Five differentiators, anchored in deliberate design choices rather than fabricated technical moats:

1. **Local presence in Iberia.** Portuguese and Spanish UX, founder reachable directly, sales conversations in the customer's language. Boardfy is Spanish-headquartered but oriented at CMS integrations; Boostmyshop is French-language-first. Localized depth wins where localized breadth doesn't exist.
2. **Flat-fee transparent pricing.** €50/marketplace/month, no setup fee, no per-revenue scaling, no surprise add-ons. Capterra reviews of incumbent tools repeatedly flag pricing-model resentment as the #1 complaint. We make pricing the trust signal, not the friction point.
3. **Direct shop_api_key + PRI01 architecture.** Sidesteps MiraklConnect dependency that constrains Boostmyshop. Works on every Mirakl marketplace whether or not the operator enables connector aggregation. Cleaner, faster, more reliable.
4. **Trust architecture as deliberate brand.** Encrypted vault, dry-run, audit log, informed-consent Go-Live, anomaly freeze, outbound circuit breaker, nightly reconciliation. These aren't features bolted on — they're the entire posture. The free report (no API keys stored) and the paid tool (encrypted vault) form a coherent two-step trust funnel by design.
5. **Cooperative-with-ERP design.** Most repricers fight the seller's existing inventory sync. We treat external price changes as signals of new pricing intent and absorb them as baselines. This eliminates a known operational friction that incumbents tolerate.

The honest moat is **execution speed + local trust + first-mover positioning in an underserved Iberian segment**, not algorithm sophistication. Mirakl could ship native repricing tomorrow; the defensibility lives in workflow embed, customer relationships, and being the obvious local choice.

## Who This Serves

**Primary buyer & user (same person):** Iberian SME sellers operating on Worten PT/ES with 5k-100k+ active SKUs, doing €10k-€100k+/month GMV, primarily in electronics, cosmetics, home goods, and appliances. Decision-maker is typically the owner/operations lead at companies of 5-50 employees. Tech-comfortable but not engineering-heavy — relies on tooling, doesn't build it.

**Concrete named pipeline (warm leads from existing outreach):**

- **Tony Cardosa @ You Get** — 8.4k Worten products, 25 marketplaces total (5 Mirakl confirmed), zero pricing automation, meeting "very positive." Highest LTV at ~€250/mo if multi-marketplace lands.
- **Ricardo Morais @ WDMI / Oportunidade24** — 50k total SKUs across 4 Mirakl marketplaces (mix of new commodity electronics in-scope + refurbished structurally out of scope — Worten has no shared EAN catalog for seller-created refurbished listings, so the engine cannot help on that portion). Thin margins on the in-scope portion, floor protection critical. Group-level decision-maker, knowledgeable. **LTV is partial and unknown** until in-scope SKU ratio is verified with Ricardo.
- **Rui Ventura @ Servelec** — ~70k products, CEO confirmed "makes total sense for us."
- **Carlos / Rui @ MCGAD** — 25k+ Worten sales, single-marketplace, raised explicit "no company/brand" trust objection (now half-mitigated by ToS + brand; full mitigation pending domain + professional email).

These are the candidates for first paying customer. The ~25 additional warm leads in the outreach tracker form the second cohort.

**Aha moment:** The seller sees their first dry-run output — *"Tool would have moved 1,847 of your SKUs to 1st place in the last simulation, with no SKU dropping below your margin tolerance"* — backed by an audit log they can investigate (search by SKU/EAN to verify any single decision; daily summary card for the headline; "atenção required" feed for events that need their input). Same numbers they saw in the free report, now actionable, with hierarchical drill-down rather than a chronological firehose.

## Success Criteria

The brief commits to four measurable outcomes as MVP exit criteria:

| Metric | Target | Why |
|--------|--------|-----|
| **Time to first paying customer** | ≤ 8 weeks from MVP start | Forces scope discipline; aligned with 2-3 weeks build + 1 week dogfood (validates cooperative-ERP-sync against Gabriel's live 15-min Worten Mirakl sync — real production testbed, not synthetic) + 2 weeks first-customer onboarding + 1 week to live + buffer |
| **Dry-run-to-Go-Live conversion** | ≥ 1 of 3 onboarded leads converts to paid Go-Live | If three warm leads onboard but none flips to live, the product doesn't actually deliver — this is the ultimate proof point |
| **Repricing efficacy on first customer** | ≥ 60% of *contested* SKUs reach 1st place after 5 cycles, while respecting floor. ***Contested*** = active SKUs where seller is not currently in 1st AND the leader's `total_price` is at or above seller's floor (i.e., reachable within tolerance) | Validates the engine actually does what the value prop promises, on the SKUs where it could plausibly act |
| **First-customer retention through month 3** | First paying customer still subscribed at end of month 3 | Tests whether the product holds value past honeymoon; refund-clean window is months 1-2 |

A successful MVP is one where the engine works on a real catalog, one customer is paying through month 3, and the operational machinery (Stripe, Moloni invoicing flow, email alerts, uptime monitoring, audit log, circuit breaker) has run cleanly without founder intervention beyond standard support.

## Scope

### In MVP

**Marketplace coverage:** Worten PT + Worten ES (per-channel repricing, both channels MVP-required).

**Engine:** Per-SKU tiered scheduling via `tier_cadence_minutes` column — Tier 1 (contested) and Tier 2a (just won, < 4h since taking 1st) every 15 min; Tier 2b (stable winner, ≥ 4h since taking 1st) every 30-60 min; Tier 3 (no competitors) daily and serves as nightly reconciliation. Single cron polls every 5 min, dispatches by elapsed time. Undercut + ceiling logic per cycle (per-channel, ranked by `total_price`, filtered to `active=true` offers). List_price-anchored %-formula with smart defaults from onboarding margin question. Cooperative external-change absorption with 40% inbound anomaly freeze. **Outbound circuit breaker** (per-cycle 20% catalog cap, per-SKU 15% delta cap, freeze + alert on trip).

**Customer-facing UI:** Self-serve signup (Supabase Auth, email verify, RLS), single-purpose encrypted key-entry form, dashboard with PT/ES toggle + KPI cards showing the same categories as the free report in a visually consistent family (not a UI clone), audit log presented as a hierarchical investigation tool with five surfaces (daily summary card, "atenção required" feed for action-events, "notáveis" feed for browsable events, search by SKU/EAN as primary investigation primitive, cycle-aggregated firehose behind opt-in filter — chronological flat feed is NOT the default presentation; volume math forbids it), pause (freeze with baseline-snapshot retained for future restore), margin editor with worked profit example, informed-consent Go-Live modal (conditional language). Account deletion is multi-step (verification phrase + 7-day grace period; key destroyed at initiation, hard-delete at grace-period end per GDPR Article 17). Single marketplace at MVP; multi-marketplace addition is concierge-only (no self-serve UI) — full self-serve flow is Epic 2.

**Operations:** Dry-run by default. **Stripe** for recurring monthly subscription payments (€50/marketplace/month; 3-month minimum prepaid is an open decision pending warm-lead re-engagement). **Manual Moloni invoicing** by founder per Stripe payment for PT NIF/IVA compliance until volume justifies Moloni API integration. Resend for transactional email (failure alerts only — no email on healthy scan completion). UptimeRobot for cron health.

**Onboarding flow:** Free report CTA → account creation → key entry (with linked *"How to find your Worten API key"* guide) → async catalog scan with closeable progress page → onboarding questions (margin band, per-channel pricing, other repricing tools active) → dashboard populates with dry-run output → margin tuning → informed-consent Go-Live modal → Stripe subscription start → live cron + manual Moloni invoice.

**Day-1 customer success commitment.** For the first 3 paying customers specifically:
- Founder availability: 2-hour response SLA during the customer's launch week
- Active monitoring: founder tails audit log + uptime status for 24h post-Go-Live, before customer asks
- Pulse check: explicit day-3 and day-7 outreach (call or email) — *"how does it feel? anything concerning?"*
- Pre-prepared rollback playbook: documented 30-min response (pause, alert, diagnose, fix or revert) ready before first Go-Live

### Explicitly NOT in MVP (Epic 2+)

- Additional marketplaces (Phone House, Carrefour ES, PCComponentes, MediaMarkt) — concierge for any second marketplace until self-serve flow ships
- Self-serve marketplace addition flow, full settings UI beyond margin editor
- Per-SKU exclusion list, per-SKU absolute price floor (MAP/MRRP support), per-SKU pause
- Cost CSV upload + cost-based formula override (power-user mode for thin-margin sellers)
- Schedule controls (business-hours-only, weekend pause)
- Per-channel margin overrides (margins are global per customer in MVP)
- Revenue-impact reporting, historical analytics, time-series dashboards
- Multi-user accounts per customer
- Customer-facing API for ERP integration (one-way absorption only)
- Admin tooling UI for founder (SQL via Supabase Studio for MVP)
- Self-hosted Supabase (Cloud only)
- Moloni API integration (manual invoicing for MVP)
- Dedicated "price-up candidates" / ceiling-headroom panel (audit log + KPI cards cover transparency for MVP)

### Pre-revenue legal gates (must exist before first invoice)

- **ToS update** covering automated price-setting agency on the customer's behalf (existing free-report ToS does not cover this scope)
- **DPA template** for B2B customers (most procurement-conscious leads will request)
- **Refund policy:** *"First-month money-back guarantee within 14 days of Go-Live, no questions asked."* Trust-building posture for the first cohort. Note: Stripe charges only on Go-Live, so the refund scenario is "Go-Lived → tool failed to deliver" (a customer who never Go-Lived never paid; nothing to refund). Tighten policy in Epic 2 once retention data exists.
- **Worten/Mirakl operator ToS compatibility check** — confirm automated repricing via shop_api_key is consistent with their seller agreement

These do not block MVP build but block first paying customer. Founder will scope a fixed-fee legal review post-build and pre-Go-Live.

### Open questions parked for ARCH (Winston) — Mirakl MCP verification mandatory

- PRI01 mechanism for per-channel price writes (CSV format with `channel-code` column?)
- Channel codes (`WRT_PT_ONLINE`, `WRT_ES_ONLINE` — verify these are the active codes)
- Cross-channel pricing constraints (any Mirakl/Worten parity rules?)
- Single-channel offer handling (SKUs that exist on PT but not ES, or vice versa)
- `all_prices` array shape and per-channel `total_price` availability
- Source of own-shipping cost per offer (likely OF21 — verify)
- P11 / PRI01 rate limits
- KMS specification: encryption key custody, rotation policy, recovery on Supabase incident (the brief mandates encryption-at-rest; ARCH must specify *how*)

## Vision

**Year 1 (MVP → 5-10 customers):** Single marketplace, prove the engine on Iberian Worten sellers. Convert ~3 of the warm-lead pipeline. Validate retention through month 3 on customer #1.

**Year 2 (Multi-marketplace + power features):** Add Phone House, Carrefour ES, PCComponentes, MediaMarkt — **mostly configuration plus per-operator integration testing of P11/PRI01 quirks** (each new marketplace ~1-2 weeks of work, not zero). Ship cost-based override mode for thin-margin sellers, per-SKU absolute floors for MAP/MRRP-controlled brands, per-SKU exclusion. Self-serve marketplace addition flow. Revenue-impact reporting in dashboard. Target: 30-50 paying customers across 5 Mirakl marketplaces.

**Year 3+ (Iberian default + adjacent moves):** Become the obvious local choice for Mirakl repricing in Iberia. Possible adjacencies: extension to non-Mirakl marketplaces (KuantoKusta, etc.), feed-management bolt-on to compete with Lengow/ChannelEngine on the Iberian segment, partnerships with Worten/Phone House operators for in-platform integration, anonymized Iberian Mirakl pricing-index data product. Defensibility is local trust + workflow embed + first-mover positioning, not algorithm.

## Risks & Dependencies

- **Sales re-engagement of warm leads.** Timeline assumes Tony / Ricardo / Rui / Carlos re-engage when contacted with credibility infrastructure (domain, professional email) shipped. Failure to re-engage delays revenue independent of build velocity. **Mitigation:** Track A (sales/credibility) runs in parallel with build, smallest-action path (one lead at a time) starting with Tony @ You Get. **Plan B trigger:** if no Go-Live customer by week 6 of MVP completion, escalate to (a) restart cold outreach to fresh leads using the existing OUTREACH.md playbook, AND (b) actively market the free opportunity report as inbound funnel (LinkedIn, ACEPI/Adigital channels, Worten seller forums). Plan B is parallel paths, not sequential.
- **Mirakl platform risk.** Mirakl could ship native repricing or change shop API behavior with limited notice (Fnac's exit was the precedent). Single-marketplace concentration in MVP is existential. **Mitigation:** Epic 2 multi-marketplace expansion within 6 months; embed defensibility in workflow + local trust rather than algorithm.
- **Boardfy €19 sticker price-anchor pressure.** Prospects who comparison-shop will price-anchor against Boardfy's headline number. **Mitigation:** total-cost-of-ownership messaging (no add-ons, no per-revenue), local presence as differentiator, flat-fee transparency as deliberate positioning.
- **Trust incident.** Any leak/misuse of stored API keys is catastrophic and unrecoverable for the brand. **Mitigation:** encryption-at-rest non-negotiable, single-purpose key-entry form (founder never sees plaintext), Supabase Cloud EU region for data residency, explicit ToS coverage of repricer agency, KMS spec from ARCH.
- **First-customer bad experience kills the brand.** A bug, outage, or mis-priced batch on customer #1 reaches the network whether legally Pedro's fault or not. **Mitigation:** the Day-1 customer success commitment above (founder SLA, active monitoring, pulse checks, rollback playbook), plus the three-layer write safety stack (tiers + circuit breaker + nightly reconciliation).
- **Cooperative ERP absorption may amplify some ERP failures.** The 40% inbound deviation guard catches order-of-magnitude errors but not 10-20% margin-eroding drift, which is the more common ERP failure mode. **Mitigation:** anomaly threshold customer-tunable in Epic 2; for MVP, dashboard surfaces every external-change-absorbed event in the audit log so customer can spot drift.
- **Solo founder bandwidth & continuity.** All build, sales, support, and ops live with one person. **Mitigation:** BMAD/BAD methodology for AI-assisted development velocity; Supabase + Stripe + Resend + UptimeRobot for managed-service offload of undifferentiated infrastructure; concierge ops for first 3-5 customers (founder watches initial runs); written 1-page runbook for laptop loss / hospitalization scenarios prepared before customer #1.
- **Lengow / ChannelEngine** could bolt repricing onto existing feed-management offerings. **Mitigation:** ship faster, embed locally, differentiate on Iberian depth.

## Inputs Used

This brief synthesizes:

- `CLAUDE.md` — project-level constraints, MMP-only architecture, encryption mandate, Mirakl MCP verification mandate
- `RESEARCH.md` — technical feasibility, P11/PRI01 confirmation, repricing logic foundations, **tier system foundation**, scale math, competitor inventory
- `OUTREACH.md` — ~30-lead sales pipeline, named warm leads, sales scripts, multi-marketplace upsell evidence
- `PRICING.md` — historical pricing context (model superseded by current decisions; included for chain-of-custody)
- **Strategic planning conversation 2026-04-28** — load-bearing input. Decisions on the list_price-anchored %-formula, smart defaults from onboarding margin question, cooperative ERP-sync absorption, anomaly freeze, dry-run + informed-consent Go-Live, Stripe-with-manual-Moloni billing, per-channel as MVP requirement, three-layer write safety (tiers + circuit breaker + nightly reconciliation), Day-1 customer success commitment, Plan B for warm-lead silence, Resend + UptimeRobot for ops, Epic 2 deferrals, MCP verification list — all originate here, not in the documents
- **Web research synthesis** — Boardfy/Boostmyshop pricing & user sentiment from Capterra/GetApp, Mirakl ecosystem trends (Fnac exit June 2025, Worten Mirakl Ads launch July 2025), market sizing data points
