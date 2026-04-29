---
title: "UX Skeleton: marketpilot-repricer"
status: "complete — Pass 1 (structural)"
author: "Sally (UX Designer)"
date: "2026-04-29"
inputs:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/product-brief-marketpilot-repricer.md
  - _bmad-output/planning-artifacts/product-brief-marketpilot-repricer-distillate.md
  - CLAUDE.md
  - /tmp/marketpilot-design/test-marketpilot/ (free-report design bundle — visual DNA reference)
purpose: "Structural UX skeleton for downstream Claude Design pass + implementation. Defines sitemap, flows, screen states, IA for data-dense surfaces, trust-messaging treatment, mobile/internal/edge-case decisions, and PT microcopy for critical-action surfaces. Pass 2 (post-Claude-Design) covers visual polish."
---

# UX Skeleton — MarketPilot Repricer

## §0 How to read this document

Pass 1 is **structural**, not visual. Sitemap, flows, screen states, IA, microcopy. Visual mockups come from a downstream Claude Design pass that consumes this skeleton + `_bmad-output/planning-artifacts/prd.md` + the free-report bundle at `/tmp/marketpilot-design/test-marketpilot/`. Pass 2 polishes the resulting visuals.

**Authoring convention.** Every UX requirement is numbered (`UX1`, `UX2`, …) and traces to FRs/NFRs in the PRD. Every PT microcopy block is verbatim, ready to paste. PT register matches the free-report voice: second-person singular (`tu`), declarative, anti-promissory, no imperatives in titles, no claims unbacked by data.

**Visual DNA is binding.** Tokens, type stack (Manrope display 700/800 · Inter body · JetBrains Mono tabular), icon system (Material Symbols Outlined with FILL variations — no emoji), animation primitives (`fadeUp`, `pulseDot`, `shimmer`, `progressBar`, `spin`), 1400px max-width, 8/12/18px radius scale, 3-tier shadow scale, ambient tonal radial-gradient washes, uppercase letter-spaced eyebrow labels, pulse-dot status badges — all carry directly from `MarketPilot.html`. **Structural arc does NOT carry**: the report's 4-section narrative arc (Status → Recover → Squeeze → Claim → CTA) is a static branded artifact pattern. The dashboard is a multi-tenant operational UI; it borrows tokens, not structure.

**PRD amendments tracked in §14.** FR4 (account deletion is multi-step + grace period, not single-click) and FR41 (add-marketplace is concierge-only at MVP, not customer self-serve).

---

## §1 Sitemap

```
Public (out of scope here; lives in DynamicPriceIdea repo)
└── marketpilot.pt landing — free-report CTA targets repricer signup with ?source=free_report

Auth & Account [FR1, FR3, FR5, NFR-S5]
├── /signup
├── /verify-email          (Supabase chrome, minor brand polish)
├── /login
├── /forgot-password
└── /reset-password

Onboarding (first-login state machine, sequential) [FR8–FR16]
├── /onboarding/key        single-purpose API key entry
├──   modal: Como gerar a chave Worten   (FR10 one-pager, modal preferred over route)
├── /onboarding/scan       async progress, closeable + reconnectable
├── /onboarding/scan-ready catalog quality summary (NEW — see §8.3)
└── /onboarding/margin     single margin band question + smart default preview

Dashboard (post-onboarding root) [FR30–FR39]
├── /                      KPI cards, channel toggle, recent-events condensed view,
│                          pause/resume control, margin editor inline panel,
│                          Go-Live CTA when in dry-run
├──   modal: Go-Live informed consent       [FR31]
└──   modal: Anomaly-freeze review (per-SKU) [FR29]

Audit Log [FR37, FR38, NFR-S6, NFR-A3]
├── /audit                 5-surface investigation tool — see §4.1
├── /audit?sku=EAN         search result (the primary investigation primitive)
└── /audit/firehose        cycle-aggregated all-events view (drill-down)

Settings
├── /settings/account      email, password change
├── /settings/key          vault status, last-validated timestamp, rotate key
├── /settings/marketplaces read-only list at MVP (concierge for additions, §8.5)
├── /settings/billing      Stripe Customer Portal link + invoice list
└── /settings/delete       multi-step initiation [FR4 amended — see §8.4]

Interception states (override dashboard root when triggered)
├── /key-revoked           mid-life key invalidated by Worten support [§8.1]
├── /payment-failed        Stripe subscription auto-cancelled [§8.2]
└── /scan-failed           catalog scan critical failure during onboarding

Internal (founder-only — service-role gated, never customer-visible)
└── /admin/status          single read-only aggregator [§7]
```

**UX1.** All authenticated routes require active session via Supabase Auth; failed auth redirects to `/login` preserving intended destination as `?next=` param. [FR1, FR2, NFR-S5]

**UX2.** First-time customers always land on `/onboarding/key` after first email-verified login. The onboarding state machine advances strictly forward; the customer cannot reach `/` until they complete `/onboarding/margin` and the scan has progressed past the readiness threshold. [FR8–FR16]

**UX3.** Returning customers land on `/` (dashboard root). If the system detects an interception state (`/key-revoked`, `/payment-failed`, `/scan-failed`), it overrides `/` with the interception screen on landing. [§8.1, §8.2]

---

## §2 User flow diagrams

Five flows. Numbered per PRD's User Journeys (Journey 5 is N/A).

### §2.1 Flow 1 — Onboarding success (mirrors PRD Journey 1: Tony @ You Get)

```
Free-report CTA (DynamicPriceIdea)
  └─→ /signup?source=free_report&campaign=tony_august  [FR7]
        ├─→ verify-email link in inbox
        └─→ /verify-email
              └─→ /login (first time)
                    └─→ /onboarding/key
                          ├─→ [click "Como gerar?"] → modal: key-help [FR10]
                          ├─→ [paste key, submit]
                          │     ├─→ inline 5-second validate [FR9, NFR-P6]
                          │     │     ├─→ INVALID → inline error, retry
                          │     │     └─→ VALID  → encrypt + persist [FR11]
                          │     └─→ kick async scan [FR12]
                          └─→ /onboarding/scan (closeable, reconnectable) [FR13, FR14]
                                ├─→ [scan FAILS] → email customer + /scan-failed [FR15]
                                └─→ [scan COMPLETES — silent, no email per FR15]
                                      └─→ /onboarding/scan-ready  (NEW per §8.3)
                                            └─→ /onboarding/margin
                                                  ├─→ pick band [FR16]
                                                  ├─→ <5% band → inline warning [FR16]
                                                  └─→ submit
                                                        └─→ /  (dashboard, dry-run state)
                                                              ├─→ review dry-run audit-log
                                                              │   notable feed [§4.1.3]
                                                              ├─→ tune margin in editor [§4.3]
                                                              │   (live worked-profit-example)
                                                              └─→ click "Go Live"
                                                                    └─→ modal: Go-Live consent
                                                                          ├─→ unchecked → disabled
                                                                          ├─→ checked → Stripe enabled
                                                                          ├─→ Stripe success
                                                                          │   └─→ cron flips active
                                                                          │   └─→ / (live state)
                                                                          └─→ Stripe fail → modal stays
```

### §2.2 Flow 2 — Anomaly + Circuit-breaker (mirrors PRD Journey 2: Ricardo @ WDMI)

```
Live customer
  └─→ engine detects external price change >40%   [FR29]
        ├─→ freeze that SKU
        ├─→ critical email via Resend (≤5 min)    [FR48, NFR-P9]
        └─→ dashboard banner: "X SKU(s) precisam de revisão"
              └─→ click banner OR audit-log Atenção feed entry
                    └─→ modal: Anomaly review (per-SKU)
                          ├─→ "Confirmar novo list_price"
                          │     └─→ unfreeze with new baseline
                          └─→ "Rejeitar (manter list_price anterior)"
                                └─→ unfreeze with old baseline

  └─→ engine detects >20% catalog-per-cycle OR >15% per-SKU move [FR26, FR27]
        ├─→ freeze entire cycle
        ├─→ critical email
        └─→ dashboard banner: "Ciclo congelado por segurança"
              └─→ click banner
                    └─→ Atenção feed entry: circuit-breaker-trip
                          ├─→ shows affected SKUs, deltas, root cause
                          ├─→ "Pausar repricing" (immediate)
                          ├─→ "Investigar no audit log" → search by cycle-id
                          └─→ "Retomar" (after manual review)
```

### §2.3 Flow 3 — Founder critical-alert response (PRD Journey 3, Pedro 22:47)

```
Pedro on phone
  └─→ UptimeRobot alert: /health failed 2 consecutive 5-min pings
        └─→ open laptop → /admin/status   [§7]
              ├─→ uptime card: "/health: 2 fails, 8m ago"
              ├─→ per-customer health rollup (Tony's row red)
              ├─→ recent critical events (cross-customer audit tail)
              └─→ if banner-trigger threshold hit: customer-facing banner
                    appears automatically on / for affected customers [FR39]

  └─→ Investigation:
        ├─→ click Tony's row → opens Tony's customer audit log via service-role
        │   bypass [FR6, FR47]
        └─→ if recovery: cycle resumes naturally, banner clears

  Out-of-band actions Pedro takes:
        └─→ Supabase Studio for ad-hoc SQL (not a designed product surface)
        └─→ UptimeRobot UI for monitor history (external)
```

### §2.4 Flow 4 — Customer self-investigation (PRD Journey 4)

```
Tony / warehouse manager notices a Worten reprice
  └─→ /audit
        └─→ search box: paste EAN
              └─→ /audit?sku={EAN}
                    └─→ chronological event list for that SKU only:
                          ├─→ 03:14  competitor X listed at €1,485
                          ├─→ 03:14  engine: undercut to €1,478
                          │           floor €1,455, ceiling €1,575, Tier 1
                          ├─→ 03:14  PRI01 submitted
                          └─→ 03:16  PRI02 COMPLETE
                    └─→ user closes tab, no support ticket

Total time: 90 seconds. Audit log is the trust deliverable.
```

### §2.5 Flow 5 — Account cancellation + deletion

```
Customer in /settings/billing
  └─→ click "Cancelar subscrição"
        └─→ link out to Stripe Customer Portal (Stripe owns cancel UX) [FR43]
              └─→ subscription cancels → cron flips paused via webhook
                    └─→ /  shows /payment-cancelled state (variant of paused)
                          └─→ data retained, customer can re-enter Stripe + resume

To delete account entirely (separate flow):
  └─→ /settings/delete   [FR4 amended per §8.4]
        ├─→ Step 1: warning page describing what gets wiped vs retained
        ├─→ Step 2: type "ELIMINAR" verification phrase + email
        ├─→ Step 3: confirmation email + 7-day grace period begins
        │           account suspended, dashboard locked, data still recoverable
        └─→ Step 4 (T+7d): hard delete per GDPR Art 17 [NFR-S1, FR4]
              └─→ Moloni invoice metadata retained as fiscal record
```

---

## §3 Screen state diagrams

States are **mutually exclusive** unless noted. Banners stack additively above primary state.

### §3.1 Dashboard root `/`

| State | Trigger | Visual treatment | Banner | CTA |
|---|---|---|---|---|
| **Loading** | initial fetch | skeleton KPI cards (shimmer) | — | — |
| **Empty (post-scan, pre-Go-Live = dry-run)** | scan complete, Go-Live not yet flipped | KPI cards populated with simulated values; "MODO SIMULAÇÃO" badge top-right | persistent dry-run banner: see §9.5 | prominent **"Ir live"** button [FR30, FR31] |
| **Healthy live** | live cron running, no flags | full KPI cards, ambient washes, audit-log highlights | — | margin editor accessible |
| **Paused — customer-initiated** | customer clicked pause [FR32] | KPI cards greyed 60% opacity; pause icon top-left | grey banner: see §9.4 | **"Retomar"** button (single click) |
| **Paused — payment failure** | Stripe sub auto-cancelled [FR43] | KPI cards greyed; warning icon (NOT pause icon) | red banner: see §9.6 | **"Atualizar pagamento"** → Stripe Portal |
| **Anomaly attention** | ≥1 SKU frozen [FR29] | normal KPI cards | yellow banner: see §9.7 | **"Rever X eventos"** → /audit Atenção feed |
| **Circuit-breaker frozen** | cycle halted [FR27] | KPI cards stale-watermarked | red banner: see §9.8 | **"Investigar"** + **"Retomar"** |
| **Sustained transient** | ≥3 consecutive cycle failures [FR46, FR39] | KPI cards stale-watermarked, timestamp visible | grey banner: see §9.9 | (informational, no action) |
| **Initial scan in progress** | scan started, dashboard not ready yet | redirect to `/onboarding/scan` | — | — |

**UX4.** Banner stacking order top-down: payment failure > circuit breaker > anomaly attention > sustained transient > dry-run. Only the highest-precedence banner is visible at a given time; lower-precedence banners reappear when the higher one clears. [FR39, FR46]

**UX5.** The `pause` and `payment-failed` states use **distinct visual treatments**: customer-initiated pause uses a calm grey + pause-icon (`pause_circle` filled); payment-failed uses a warning-amber + warning-icon (`warning` filled). Same icon for both = trust failure. [FR32, FR43]

### §3.2 Key-entry form `/onboarding/key`

| State | Visual |
|---|---|
| Empty | input placeholder visible, validate button disabled |
| Filled, idle | validate button enabled |
| Validating | spinner, button disabled, label "A validar a tua chave..." (≤5s per NFR-P6) |
| Validation success | green check, transition to `/onboarding/scan` |
| Validation failure — invalid key | inline error in red below input, focus stays |
| Validation failure — network error | inline retry CTA |
| Already-validated re-entry (rotation flow from `/settings/key`) | shows last-validated timestamp + rotate confirmation |

### §3.3 Scan progress `/onboarding/scan`

States from `MarketPilot.html` ProgressScreen apply directly:
- **Active** — radial progress glyph + shimmer bar + 4-phase checklist; phase counts up live
- **Disconnected/reconnected** — same view, server-side state per FR14
- **Failed (critical)** — error icon, "A análise não conseguiu completar. Verifica o teu email para detalhes." [FR15]

**UX6.** Phase labels for repricer scan (replacing the report's phases): "A obter catálogo · A snapshotar baselines · A classificar tiers iniciais · Pronto." Each emits server-side progress events the page subscribes to.

### §3.4 Margin editor (inline panel on dashboard)

| State | Visual |
|---|---|
| Read | current `max_discount_pct` + `max_increase_pct` shown; worked-profit-example computed and displayed |
| Editing | live update on input; example recomputes per keystroke (debounced ~150ms) |
| Out-of-range | red border + inline message "Valor entre 0% e 50%" (no save) |
| Saved | green flash on save button, "Guardado às HH:MM" timestamp |
| Customer in <5% margin segment | persistent warning: see §9.10 |
| Refresh-example button (cycle through top 5 SKUs) | secondary action right of example |

See §4.3 for the full example mechanics.

### §3.5 Audit log `/audit`

| State | Visual |
|---|---|
| Loaded healthy (default) | 3 surfaces stacked — Daily summary card, Atenção feed (or empty state), Notável feed |
| Atenção feed has items | yellow-bordered card, count badge, all items expanded by default |
| Atenção feed empty | small green confirmation: "Nada que precise da tua atenção." |
| Search-by-SKU active | search bar populated, results replace stacked surfaces |
| Search no results | "Nenhum evento para EAN {X} nos últimos 90 dias." [NFR-P8] |
| Loading | skeleton placeholders per surface |
| Date-range filter open | popover with quick ranges (Hoje · Últimos 7 · Últimos 30 · Últimos 90 · Personalizado) |
| Beyond 90-day window | warning: "Filtros >90 dias podem demorar mais" [NFR-P8] |

### §3.6 Go-Live consent modal

States: idle (checkbox unchecked, Stripe button disabled) → checked (Stripe button enabled) → Stripe redirect (loading) → success returns to dashboard live state, failure returns to modal idle. Microcopy in §9.1.

### §3.7 Anomaly review modal

States: loaded with per-SKU detail (current price, previous list_price, deviation %, before-after chart for last 7 days if available) → submitting accept → submitting reject → done (modal closes, banner re-evaluates). Microcopy in §9.2.

---

## §4 Information architecture for data-dense surfaces

### §4.1 Audit log — five investigation surfaces

The audit log is **not a chronological feed**. Volume math: 50k SKUs × ~30% contested × Tier-1 cadence ≈ 100–500 actual writes per cycle, ≈ 10k–50k entries per day, ≈ 3M per quarter. Flat chronological at this volume drowns the customer in routine and buries actionable events. The log is reframed as an **investigation tool with five surfaces**:

#### §4.1.1 Surface 1 — Daily summary card

Top of `/audit`. Headline aggregates only. Updates every 5 min.

```
HOJE (até 14:22)
─────────────────────────────────────────────────
384 ajustes        22 holds       12 absorções    1 anomalia
                                  ERP             a rever ▸

Posição: 4.823 SKUs em 1.º (+12 vs ontem)
```

**UX7.** Daily summary card is the customer's daily glance. Counts are clickable: clicking "12 absorções ERP" filters the Notável feed to that event type for today. [FR37, FR38]

#### §4.1.2 Surface 2 — Atenção feed (action-required)

Only events where the customer needs to make a decision. Steady state: 0–2/day. Surface ≥1 = it actually matters.

Event types in this feed:
- `anomaly-freeze` — external price change >40%, awaiting accept/reject [FR29]
- `circuit-breaker-trip` — cycle halted, awaiting manual unblock [FR27]
- `key-validation-fail` — mid-life key revocation [§8.1]
- `pri01-fail-persistent` — PRI01 failures >3 consecutive cycles for same SKU
- `payment-failure-pause` — Stripe sub auto-cancelled [FR43]

**UX8.** Atenção feed items render expanded by default. No collapse-by-default. Each item carries: timestamp, scope (per-SKU or system-wide), affected SKUs (if applicable), root cause snippet, primary action button, secondary "Ver detalhes". When 0 items: small green confirmation (avoid the "no records" empty-state void).

#### §4.1.3 Surface 3 — Notável feed (interesting, capped)

Moderate-frequency events the customer might browse out of curiosity. Steady state: 5–30/day. Capped to 30 visible with "Ver todos" link to firehose-filtered.

Event types:
- `external-change-absorbed` — ERP/manual edit absorbed as new baseline [FR22]
- `position-won` — SKU moved to 1st place
- `position-lost` — SKU dropped from 1st place
- `new-competitor-entered` — Tier-3 SKU detected first competitor
- `large-price-move-within-tolerance` — single push >5% but ≤15% (just under circuit breaker)
- `customer-paused` / `customer-resumed`

**UX9.** Notable feed items are collapsed-by-default (one-line summary), expand on click for detail. Each item filterable in-place ("Ver só absorções ERP"). Per-channel filter chip pinned above feed (PT · ES · Ambos).

#### §4.1.4 Surface 4 — Search by SKU/EAN (primary investigation primitive)

Search box at top of `/audit`. Customer types EAN or product name. Results replace the three feeds with a chronological list of **all events for that one SKU** within the active date range (default: last 90 days).

Per-SKU event detail: every event is rendered (Atenção + Notável + Rotina) because for one SKU the volume is bounded and inspection is the goal.

**UX10.** Search-by-SKU is the most common investigation pattern (per PRD Journey 4). It is the primary affordance: the search box is sticky-top, focus on `/` audit landing if there is no Atenção to surface. [FR38]

#### §4.1.5 Surface 5 — Firehose `/audit/firehose`

Behind a "Mostrar todos os ajustes" link in the daily summary card. Cycle-aggregated, NOT flat per-SKU:

```
03:14 ciclo (Tier 1 + Tier 2a — 47 ações)              ▾
  ↓ 43 undercuts · preço médio: -€2,14
  ↑ 4 aumentos · preço médio: +€1,87
  ⏸ 12 holds · 3 abaixo do floor, 9 já em 1.º
  [Expandir SKUs ▸]
```

Drill into a cycle to see per-SKU rows. Drill into a SKU row to see its decision detail (competitor context, engine rationale, tolerance band, PRI01/PRI02 status). [FR37]

**UX11.** Firehose is opt-in. It exists for trust verification ("show me everything"), not daily use. Performance budget: cycle list paginated 50 cycles per page; SKU expansion lazy-loaded. [NFR-P8]

#### §4.1.6 Event-type taxonomy (~22 types, classified by default surface)

| Class | Default surface | Event types |
|---|---|---|
| **Atenção** (action required) | Surface 2 | `anomaly-freeze`, `circuit-breaker-trip`, `key-validation-fail`, `pri01-fail-persistent`, `payment-failure-pause` |
| **Notável** (browsable) | Surface 3 (capped 30) + 4 (search) + 5 (firehose) | `external-change-absorbed`, `position-won`, `position-lost`, `new-competitor-entered`, `large-price-move-within-tolerance`, `customer-paused`, `customer-resumed`, `scan-complete-with-issues` |
| **Rotina** (high-volume) | Surface 4 (search) + 5 (firehose) only — hidden from default feeds | `undercut-decision`, `ceiling-raise-decision`, `hold-floor-bound`, `hold-ceiling-bound`, `hold-already-in-1st`, `cycle-start`, `cycle-end`, `pri01-submit`, `pri02-complete`, `pri02-failed-transient`, `tier-transition` |

**UX12.** Trust property preserved: every event is recorded and accessible via Surface 4 (search) or Surface 5 (firehose). The default surfaces don't drown the customer in routine; they don't omit anything. [NFR-S6]

### §4.2 Dashboard `/` — KPI grouping and channel toggle

#### §4.2.1 Layout hierarchy (top-to-bottom)

1. **Sticky header** — Logo · channel toggle (PT / ES) · pause/resume control · Settings link · session avatar
2. **Banner zone** — UX4 stack (only highest-precedence visible)
3. **KPI card row** — three status cards from free-report family: `Em 1.º lugar`, `A perder posição`, `Sem concorrência (Tier 3)`. Each carries a `valor de catálogo` secondary line per the report's pattern. Channel-scoped to the active toggle.
4. **Margin editor inline panel** — collapsed by default (chevron expand), shows current `max_discount_pct` / `max_increase_pct` summary as one-line in collapsed state. Expanded shows §4.3 worked-profit-example + edit fields.
5. **"Hoje" condensed audit-log preview** — 3-line strip pulling top of Daily summary card from `/audit`. CTA: "Ver audit log completo" → `/audit`
6. **Recent Atenção items** — if any, expanded preview cards (max 3); else no row
7. **Go-Live CTA panel** — visible ONLY in dry-run state; prominent navy gradient panel near bottom with N-products summary and "Ir live" button [FR30, FR31]

**UX13.** The dashboard does NOT replicate the free report's 4-section narrative arc. It uses the report's KPI card visual treatment (3 status cards in tonal tints — green/red/blue) but does NOT include the report's "A um passo do 1.º" rocket hero card or "Maiores oportunidades / Margem para subir / Vitórias rápidas" tables. Those are report-only artifacts. The dashboard is operational, not narrative.

#### §4.2.2 Channel toggle behavior

- Pill toggle in sticky header, identical visual to the report's PT/ES toggle (carried directly from `MarketPilot.html`).
- Toggle scope: KPI cards, margin-editor worked-example SKU candidate pool, "Hoje" audit-log preview, Recent Atenção items. **Not** the global banner zone (banners are system-level, not channel-level — exception: anomaly counts in `§9.7` banner specify per-channel split when both have items).
- Toggle persists per-session (sticky between visits via local storage).
- Default channel on first dashboard load: **PT** (since founder is PT-based and most warm leads are PT-primary).

**UX14.** Channel toggle is single-select at MVP (PT or ES, never "Both"). A "Both" merged view requires cross-channel deduplication by EAN (per chat-transcript §3 nuance) and is deferred to Epic 2. [FR25, FR35]

### §4.3 Margin editor — worked-profit-example mechanics

#### §4.3.1 Representative SKU selection (UX-deterministic rule)

**UX15.** The worked-example SKU is selected automatically by this rule, evaluated at editor mount (re-evaluated on channel toggle change):

1. Filter: `tier IN (1, 2a, 2b)` (contested or recently-contested; Tier 3 silent SKUs make for a bad demo).
2. Filter: `current_price` is between catalog `p25` and `p75` price quartiles (avoid outliers — don't demo on a €1,500 TV when most products are €30).
3. Rank: ascending by `|current_price - catalog_median_price|` (closest to the median).
4. Pick the top SKU.

**UX16.** A "Ver outro" refresh button cycles through the top 5 candidates by the same rule. Pure UX affordance; doesn't change the engine. [Distillate §18]

**UX17.** If the catalog has zero SKUs satisfying the filter (rare, e.g., entirely Tier 3 catalog or single-SKU catalog), display: *"Adiciona produtos contestados ao catálogo para ver um exemplo prático. Os teus limites continuam a aplicar-se."* Customer-pickable SKU is reserved for Epic 2.

#### §4.3.2 Stated-margin assumption (UX-deterministic rule)

**UX18.** When back-calculating the worked example, use the **floor of the customer's selected margin band**:
- `<5%` band → assume 5% margin in calculation (the band's *upper* bound, treated as floor of the example since "<5%" effectively means "at most 5%")
- `5-10%` band → assume 5%
- `10-15%` band → assume 10%
- `15%+` band → assume 15%

This is the **conservative** interpretation: the example shows tighter remaining margin than reality if the customer's actual margin is higher than the band's floor. Customer is pleasantly surprised when actual results exceed the example, never misled.

**UX19.** Display the assumption explicitly in the editor caveat: see §9.11.

#### §4.3.3 Editor anatomy

Two numeric inputs (`max_discount_pct`, `max_increase_pct`), worked-profit-example panel beside them.

```
┌─ Margem de tolerância ─────────────────────────────────────┐
│                                                            │
│   Reduzir até       Aumentar até                           │
│   [ 1.5% ▾ ]        [ 5.0% ▾ ]                             │
│                                                            │
│  ───────────────────────────────────────────────           │
│                                                            │
│   EXEMPLO COM A TUA MARGEM                       [Ver outro]│
│                                                            │
│   Sony Bravia XR-55A80L OLED 55"                           │
│   Preço actual: €799,00                                    │
│   ───────────                                              │
│   Preço mínimo permitido:    €787,02   (-€11,98)           │
│   Impacto na margem:         -€11,98 / -1.5%               │
│   Margem restante:           ~€39,95   (~5%)               │
│                                                            │
│   Estimativa baseada na margem 5% indicada no onboarding.  │
│   Se a margem real for superior, o impacto será menor.     │
│                                                            │
│  ─────────────────────────────────────────────────────     │
│                                                            │
│                                       [Guardar alterações] │
└────────────────────────────────────────────────────────────┘
```

**UX20.** Live update on input: example recomputes on each keystroke, debounced ~150ms. Numeric inputs accept percentages with one decimal (1.5%); validation is client-side (0–50% range, re-validated server-side on save). Out-of-range = red border + inline message, save disabled.

**UX21.** Save action is explicit (button, not auto-save). New values take effect at the *next* cycle, not immediately — display a confirmation toast: *"Margens guardadas. Aplicado a partir do próximo ciclo (~15 min)."*

### §4.4 Settings architecture

| Page | Content |
|---|---|
| `/settings/account` | Email (read-only at MVP; change via Supabase flow), password change, last login timestamp |
| `/settings/key` | Key vault status pill (Encriptada · Validada às HH:MM em DD/MM); rotate-key button (triggers UX-flow same as `/onboarding/key` in rotation mode); never displays plaintext (NFR-S1) |
| `/settings/marketplaces` | Read-only list: "Worten PT" (active). "Worten ES" if added concierge. "Adicionar marketplace" displays as disabled button with tooltip: *"Contacta-nos em hello@marketpilot.pt para adicionar mais marketplaces."* [FR41 amended, §8.5] |
| `/settings/billing` | Current plan summary (€50 × N marketplaces/month), next billing date, last invoice link, "Abrir Stripe Customer Portal" CTA (delegates to Stripe for cancel, payment method, etc.) |
| `/settings/delete` | Multi-step deletion entry (see §8.4). Discoverable but not visually prominent — small text link in bottom of `/settings/account`, full UI on click-through. |

**UX22.** Settings is sectioned navigation (sidebar on desktop, collapsed accordion on mobile). All settings pages share the same dashboard chrome (sticky header, channel toggle hidden on settings since channel is irrelevant here).

---

## §5 Trust-messaging treatment — layered system

The free report concentrates trust into one block: lock icon + green-edged box + "**nunca fica armazenada**" + privacy link. That works because there is exactly one commitment to make: the key is not stored.

The repricer's posture is **multi-faceted** — encrypted at rest · customer-controlled · founder never sees cleartext · audit-log-as-trust-deliverable. Compressing all four into one equivalent box becomes the fine-print problem we are escaping. Solution: **one primary first-class block at the highest-trust commitment moment, plus secondary trust evidence paid off across surfaces.**

### §5.1 Primary block — at the key-entry moment

**Location.** `/onboarding/key`, immediately below the API key input field. Same visual weight as the free report's prominent trust block: lock icon (Material Symbols `lock` filled, `var(--mp-win)`), green-edged box (`var(--mp-win-soft)` background + border in `color-mix(in oklch, var(--mp-win) 25%, transparent)`), 14px medium-weight body copy.

**Copy** (PT, primary commitment):

> *A tua chave fica **encriptada em repouso**. Apenas o motor de repricing a usa para falar com o Worten — nem o nosso fundador a vê em texto puro.*
>
> [Ver as nossas garantias →]

**UX23.** The "Ver as nossas garantias" link opens a modal (or `/security` page in Epic 2) with the four-facet detail. The primary block carries one promise; the modal pays off the rest. [NFR-S1, FR11]

### §5.2 Secondary evidence — paid off across surfaces

| Where | What it shows | How it reinforces trust |
|---|---|---|
| `/settings/key` | Vault status pill: "🔒 Encriptada · Validada há 12h" + last-used context | Customer confirms commitment is still honored |
| `/settings/key` rotate flow | Confirmation: "A chave anterior é destruída no momento da nova validação." | Reinforces "encrypted at rest, never logged" |
| `/audit` (entire surface) | Every action recorded, customer-readable, append-only | Audit log as the trust deliverable, not just compliance theater |
| Go-Live consent modal | "Tu confirmas. Nós executamos. Tu podes parar a qualquer momento." (footer) | Customer-as-decision-maker explicit [FR31] |
| Pause button (always visible) | Big, single-click, never more than two clicks away from any dashboard view | Trust escape valve [FR32] |
| Anomaly review modal | "Nada acontece até confirmares." | Customer-as-decision-maker on edge events [FR29] |
| Email footer (all transactional) | "Foste tu que escolheste estas margens. Podes pausar a qualquer momento em [link]." | Reinforces customer-as-authority |

**UX24.** Secondary trust evidence is *embedded in operational UI*, not in a separate "trust page." The audit log existing and being usable is itself the evidence; the consent modal language is the evidence; the always-visible pause is the evidence. [Brief §6]

### §5.3 Anti-pattern guardrails

- **No trust seals or fake badges.** The free report avoided these; the repricer must too. Honesty register applies.
- **No "we promise" or "we guarantee" verbs in copy.** Stick to factual ("é encriptada", "fica encriptada") not promissory. Matches the chat-transcript discipline.
- **No "industry-leading security" or unverifiable claims.** State what we do, not how we compare.
- **Founder name visible on `/security` modal**, in customer support email signature, and in `/admin` chrome (founder-side context). Founder accessibility is part of the trust posture per Brief §6.

---

## §6 Mobile vs desktop strategy

**Decision: desktop-first dashboard. Mobile-responsive but not mobile-optimized. One focused mobile surface — the critical-alert response moment.**

### §6.1 Why desktop-first

The PRD's operational tasks are structurally desktop:

- **Audit log filtering by SKU/EAN with cross-referenced detail** ([FR37, FR38]) — narrow viewport drops the per-row context (competitor name, position, tier, PRI lifecycle) below the fold or behind taps.
- **Margin editor with live worked-profit-example** ([FR36, §4.3]) — two inputs + live example panel needs ≥720px horizontal to read both at once.
- **Channel toggle for PT vs ES comparison** ([FR35]) — comparing competitive landscapes side-by-side is desktop work.
- **Founder Day-1 active monitoring** ([NFR-O3]) — `/admin/status` is desktop-only by design.

**UX25.** Dashboard, audit log, margin editor, settings, founder admin all target ≥1280px viewport as primary. They render acceptably to ~960px (collapse channel toggle to dropdown, settings sidebar to accordion, audit log feeds stack vertically) and remain usable but not optimized below. Below 768px = mobile-focused surfaces only (UX26).

### §6.2 The mobile-focused surfaces

NFR-P7 commits to ≤4s on 3G mobile. The "22:47 Tuesday" critical-alert moment from PRD Journey 3 is structurally mobile (customer is away from desktop, needs to react). The design serves three tasks well on mobile:

**UX26.** The following surfaces are designed mobile-first within the broader desktop product:

1. **Critical alert email → mobile dashboard glance.** Customer taps email link → `/?alert=X` opens a stripped-down dashboard variant: large status banner (UX4 stack), pause button, "Ver detalhes" link to the Atenção feed entry. No KPI cards, no margin editor, no firehose.
2. **Atenção feed entry detail.** A single anomaly-review or circuit-breaker-trip entry is fully readable and actionable on mobile (accept/reject / pause / resume buttons stacked, large hit targets ≥44px).
3. **Pause button.** Always reachable in ≤2 taps from any state. Persistent mobile bottom action bar carries pause and "ver alertas" only.

**UX27.** Mobile chrome strips the channel toggle, margin editor, settings sidebar, and audit-log firehose entirely. Mobile customer who needs those waits until desktop or accepts the responsive-degraded view.

### §6.3 Performance targets (mobile)

NFR-P7 target: ≤4s render on 3G. Implications for skeleton:

- KPI cards render skeleton/shimmer placeholders within 800ms; full data within NFR-P7 budget.
- Atenção feed loads from a separate lighter endpoint (count + top 3 entries) before Notable feed loads; customer can act on critical events before full audit log is rendered.
- Mobile bundle excludes the firehose surface entirely (lazy-loaded only when explicitly requested).

---

## §7 Internal admin — Founder status page

**Scope (decided per Pedro's redirect):** ONE small dedicated page (`/admin/status`). Everything else operational uses Supabase Studio + UptimeRobot UI + customer audit log via service-role bypass [FR6]. ~1–2 days build budget.

### §7.1 Purpose

Read-only aggregator so the founder can do Day-1 active monitoring (NFR-O3) at 22:47 Tuesday without context-switching three tools.

### §7.2 Layout (single page)

```
┌─ MarketPilot · Founder Status ────────────────── pedro.b@... ─┐
│                                                                │
│  ─ Sistema ──────────────────────────────────────────────      │
│   /health: ✓ online · 99.4% (30d)                              │
│   Mirakl P11 latency p95 (last 1h): 287ms                      │
│   PRI01 → PRI02 stuck count: 0                                 │
│                                                                │
│  ─ Customers (3) ──────────────────────────────  [order: name ▾] │
│                                                                │
│   ✓ tony.cardosa@youget.pt · You Get                          │
│     Live · Tier 1 cycle 18m ago · 0 atenção · 4823/8432 1.º   │
│                                                                │
│   ⚠ ricardom@wdmi.pt · WDMI                                    │
│     Live · 2 anomalias a rever · 1 ciclo congelado            │
│     Última ação: 03:14 — circuit breaker tripped              │
│                                                                │
│   ▢ ventura.rui@servelec.pt · Servelec                        │
│     Dry-run · scan 31% · 4 dias desde signup                  │
│                                                                │
│  ─ Recent critical events (cross-customer) ─────────────       │
│   22:42  WDMI · circuit-breaker-trip · 18% catalog · cycle X   │
│   18:11  WDMI · anomaly-freeze · SKU 8421 · -47.8%             │
│   ...                                                          │
└────────────────────────────────────────────────────────────────┘
```

**UX28.** `/admin/status` is read-only. The founder cannot edit customer data through this page — that requires Supabase Studio (deliberate friction so accidental edits are impossible). [FR6]

**UX29.** Visual register **deliberately differs from customer dashboard** — admin-aesthetics: monospace dominant, dense tables, no ambient washes, no celebratory animations, slate/cool greys. If Pedro ever shares a screenshot, no customer thinks "why does Pedro have a different/nicer view of my data?" Different visual register makes the "founder doesn't see your data the way you do" trust commitment legible.

**UX30.** Click on a customer row → opens that customer's audit log via service-role bypass (route: `/audit?as_admin={customer_id}`). The customer-side audit log UI is reused (no duplicate UI built). A subtle red admin-mode banner across the top makes the impersonation context visible. [FR6]

---

## §8 Edge case UX

### §8.1 Mid-life key revocation

**Trigger.** Worten support revokes a customer's shop API key after months of service (customer rotated for security, account closed, etc.). Engine detects `401 Unauthorized` on next P11 read.

**UX31.** Engine emits `key-validation-fail` Atenção event + sends critical email [FR48]. Cron freezes for that customer (similar to circuit-breaker-trip). On next customer login: dashboard root is **intercepted** by `/key-revoked` interception page.

**Interception copy** (PT):

> ## A tua chave Worten precisa de renovação
>
> A chave que tinhas configurada deixou de ser válida — o Worten pode tê-la revogado, ou foi rotacionada manualmente. O motor está em pausa: nada está a ser repricado neste momento.
>
> Os teus dados, audit log e margens ficam todos intactos. Cola a nova chave para retomar.
>
> [ Configurar nova chave → ]
>
> *Como gerar uma chave Worten?*

Button leads to `/onboarding/key` in **rotation mode** (UI variant noting old key destruction). On successful validation, customer returns to dashboard healthy live state. No re-onboarding, no scan repeat (catalog snapshot retained).

### §8.2 Stripe payment-failure paused vs customer-initiated paused

Per UX5: distinct visual treatments. Banner copy in §9.4 (customer pause) and §9.6 (payment failure).

**UX32.** Payment-failed state intercepts `/` with `/payment-failed` interception page on first login post-failure (similar to key-revoked). Subsequent logins still in failed state revert to dashboard with persistent red banner (UX5) — interception only triggers once, so customer can navigate to `/audit` and `/settings` to investigate without being trapped.

### §8.3 Catalog scan readiness summary `/onboarding/scan-ready`

Pedro's edge case: a 50k catalog will have SKUs without EAN, malformed EANs, refurbished structurally-out-of-scope listings, etc. The customer's first impression of data quality picture happens HERE, before the dashboard.

**UX33.** Post-scan completion, customer lands on `/onboarding/scan-ready` (NEW per this skeleton). Layout:

```
A análise do catálogo concluiu

  [ ✓ ]  31.179 produtos encontrados no Worten

         28.842  prontos para repricing
         ────────  com competidores ativos

         1.847   sem competidores (Tier 3 — vamos monitorizar)
         490     sem EAN no Worten — ignorados
                 (porquê? ▸)


  Pronto para configurar a margem?

  [ Continuar → ]
```

**UX34.** "porquê?" disclosure expands inline:

> *Produtos refurbished e listings privados não têm EAN partilhado no Worten — não conseguimos ver competidores no mesmo produto. Ficam fora do scope do repricing automático. Isto é estrutural ao Worten, não uma limitação da MarketPilot.*

This sets expectations honestly per the chat-transcript register (anti-promissory, anti-fake-data). [Distillate §14 — refurbished structurally out of scope]

### §8.4 Account deletion — multi-step + grace period (PRD FR4 amendment)

PRD FR4 says "single-click for the customer". This is wrong shape for irreversible destructive action. Per Pedro's redirect: multi-step + grace period.

**UX35.** Account deletion is a 4-step flow:

| Step | Surface | Action | Reversible? |
|---|---|---|---|
| 1 | `/settings/delete` | Customer reads what gets wiped (encrypted key, catalog snapshot, baselines, audit log) vs retained (Moloni invoice metadata as fiscal record) | Yes — back to settings |
| 2 | Same page, expanded | Type **`ELIMINAR`** + email address | Yes — clear and abandon |
| 3 | Submit | Confirmation email sent to customer; account suspended (cron paused, dashboard locked, can re-login to read but not act); 7-day grace period begins | **Yes** — customer can email founder or click "Cancelar eliminação" link in confirmation email to abort |
| 4 | T+7d (cron job) | Hard delete per GDPR Art 17 [NFR-S1, FR4 amended] | **No** — irreversible |

**UX36.** During grace period: dashboard renders a grey "Conta em eliminação · Faltam X dias" banner with prominent "Cancelar eliminação" button. All other UI disabled (read-only). [FR4 amended]

**UX37.** Confirmation email subject: *"Confirmação — eliminação da tua conta MarketPilot em 7 dias"*. Body includes: what gets deleted, what's retained for fiscal compliance, cancellation link, timestamp of irreversible deletion.

### §8.5 Add-marketplace at MVP (PRD FR41 amendment)

Per Pedro's redirect: concierge-only. No customer self-serve UI.

**UX38.** `/settings/marketplaces` shows the customer's active marketplaces (read-only). Below the list: an inactive "Adicionar marketplace" button with hover tooltip:

> *Contacta-nos em hello@marketpilot.pt para adicionar mais marketplaces. Tratamos de tudo: nova chave, scan, configuração — e somamos €50/mês na próxima fatura.*

Founder handles addition out-of-band (manual key entry via service-role admin queries → trigger scan → add Stripe line item → next Moloni invoice covers). [FR41 amended]

### §8.6 Smart-default warning for <5% margin segment

Inline warning on `/onboarding/margin` when customer picks `<5%` band. Copy in §9.10. [FR16]

---

## §9 Microcopy specifications (PT)

All copy is verbatim, ready to paste. Register: second-person singular (`tu`), declarative, anti-promissory, no imperatives in headlines, no fake claims.

> **Open question on register (§14, OQ-1):** the brief and PRD draft sometimes use plural-formal `vós` ("configuraram", "vossa"). The free report uses singular `tu`. This skeleton normalizes to **`tu`** for visual+microcopy continuity. If Pedro wants formal-plural for B2B legal weight, all `tu` instances below switch to `vós` mechanically.

### §9.1 Go-Live informed-consent modal [FR31]

```
Título:        Pronto para ir live?

Corpo:         Até **{N} produtos** poderão ter preços ajustados,
               dentro da margem de **{X}%** que configuraste. Os preços
               são otimizados a cada 15 minutos, sempre dentro da tua
               tolerância — nunca abaixo do floor, nunca acima do ceiling.

               Tu confirmas. Nós executamos. Tu podes parar a qualquer
               momento.

Checkbox:      ☐ Compreendo e autorizo o repricing automático

Botão (off):   Confirmar e ir live (€50/mês)        [disabled]
Botão (on):    Confirmar e ir live (€50/mês)        [enabled, navy gradient]

Cancelar:      Manter em modo simulação
```

`{N}` is the count of repriceable SKUs from the most recent scan. `{X}%` is `max_discount_pct`.

### §9.2 Anomaly-freeze review modal [FR29]

```
Título:        Mudança externa de preço · {SKU name}

Corpo:         Detetámos uma alteração ao preço deste produto fora dos
               nossos ciclos:

                 Antes:  €{old}
                 Agora:  €{new}    ({±deviation}%)

               Como a mudança é maior que 40%, congelámos o repricing
               deste produto até confirmares. Pode ser uma promoção
               intencional ou um erro do teu ERP.

               Nada acontece até confirmares.

Botão A:       Confirmar — usar €{new} como novo list_price
Botão B:       Rejeitar — manter €{old} como list_price
Link:          Ver histórico no audit log →
```

### §9.3 Pause button [FR32]

| State | Label | Icon |
|---|---|---|
| Live, hover | Pausar repricing | `pause_circle` (filled) |
| Confirmation | "Tens a certeza? O cron vai parar e os preços ficam onde estão até retomares." [Cancelar] [Pausar] | — |
| Paused, hover | Retomar repricing | `play_circle` (filled) |

### §9.4 Customer-paused dashboard banner [FR32, UX5]

```
[grey banner, pause icon]
Repricing pausado por ti em {DD/MM HH:MM}. Os preços no Worten ficam
onde estão até retomares.
                                              [ Retomar repricing → ]
```

### §9.5 Dry-run banner (pre-Go-Live) [FR30]

```
[blue banner, science icon]
MODO SIMULAÇÃO · O que vês são decisões que o motor TOMARIA, não acções
no Worten. Quando estiveres confortável, vai live.
                                              [ Ir live → ]
```

### §9.6 Stripe-paused banner (payment-failure) [FR43, UX5]

```
[red banner, warning icon]
Pagamento falhou em {DD/MM}. Repricing pausado para proteger a tua
conta. Os teus dados, margens e audit log ficam intactos.
                                              [ Atualizar pagamento → ]
```

### §9.7 Anomaly-attention banner [FR29]

```
[yellow banner, error icon]
{N} mudança(s) externa(s) de preço a precisar da tua revisão.
{Per-channel split if both: "{N_pt} no PT · {N_es} no ES"}
                                              [ Rever no audit log → ]
```

### §9.8 Circuit-breaker banner [FR27]

```
[red banner, gpp_maybe icon]
Ciclo congelado por segurança às {HH:MM}. {Reason snippet, e.g.,
"19% do catálogo seria repricado num ciclo".} Nada foi enviado ao
Worten desde então.
                                  [ Investigar ]    [ Retomar manualmente ]
```

### §9.9 Sustained transient banner [FR39]

```
[grey banner, schedule icon]
Atrasos temporários — verificações com a Worten estão lentas. Sem
ações de preço novas até estabilizar. Última verificação OK: {HH:MM}.
```

### §9.10 Smart-default warning for <5% margin segment [FR16]

Inline below the margin band selector when customer picks `<5%`:

```
[yellow callout, info icon]
Margem abaixo de 5%

Para catálogos com margens mais apertadas, recomendamos:

  • Manter modo simulação por mais tempo (7+ dias) antes de ir live
  • O nosso default mais conservador para ti: max_discount_pct = 0.5%
  • Numa próxima versão, vamos suportar carregamento de custos por
    SKU para um controlo ainda mais fino. Para já, o motor protege
    a margem com o tier system + circuit breaker (≤15% por SKU).

[ Compreendo e continuo ]
```

### §9.11 Margin editor caveat [UX19, FR36]

Permanent footnote inside the editor, below the worked-profit-example:

```
Estimativa baseada na margem {floor}% indicada no onboarding. Se a
margem real for superior, o impacto será menor. O exemplo mostra
um SKU representativo do teu catálogo — clica em [Ver outro] para
trocar.
```

### §9.12 Account deletion — multi-step copy [FR4 amended, §8.4]

**Step 1 page header:**
```
Eliminar a tua conta MarketPilot

Antes de continuares, lê o que vai acontecer.
```

**Step 1 body — what gets wiped:**
```
Será permanentemente eliminado:
  • A tua chave Worten encriptada (já é destruída no momento que
    inicias a eliminação — não esperamos pelos 7 dias)
  • Catálogo snapshotado, baselines, todas as decisões do motor
  • Audit log completo (excepto o que conta como evidência fiscal)
  • Todas as configurações de margem
```

**Step 1 body — what stays:**
```
Será mantido por obrigação fiscal portuguesa:
  • Metadata das tuas faturas Moloni (NIF, números de fatura, valores)
  • Referências de pagamento Stripe associadas a essas faturas
```

**Step 2 verification:**
```
Para confirmar, escreve ELIMINAR e o teu email:

  [ ELIMINAR______________ ]   [ {customer.email} ]

  [ Cancelar ]    [ Iniciar eliminação ]
```

**Step 3 confirmation toast + email:**
```
Eliminação agendada para {date_T+7}. Tens 7 dias para mudar de ideias —
a qualquer momento podes cancelar no email que te enviámos ou ao
voltar aqui.
```

**During grace period (banner on dashboard):**
```
[grey banner]
Conta em eliminação · Faltam {N} dia(s). Toda a actividade está
pausada. Podes cancelar a eliminação a qualquer momento.
                                          [ Cancelar eliminação → ]
```

### §9.13 Sign-up trust line (below form)

```
A tua chave Worten só é pedida no passo seguinte, depois de criares
a conta. Fica encriptada — nem o nosso fundador a vê em texto puro.
```

(Mirrors the report's first-class trust block treatment but at the right moment in the funnel — sign-up is pre-key-trust, full trust block lands on `/onboarding/key` per §5.1.)

---

## §10 Visual DNA continuity rules

What carries from `/tmp/marketpilot-design/test-marketpilot/project/MarketPilot.html` to the repricer dashboard, and what does NOT.

### §10.1 Carries (binding for Claude Design)

- **Color tokens** — `--mp-primary #00113a`, `--mp-primary-2 #002366`, `--mp-primary-tint #dbe1ff`, `--mp-bg #f5f7fa`, `--mp-surface #ffffff`, ink scale (`--mp-ink #0a1230` → `--mp-ink-2 #3a4560` → `--mp-ink-3 #6b7896`), line scale (`--mp-line #e1e5ec` → `--mp-line-soft #edf0f5`), semantic OKLCH (`--mp-win`, `--mp-loss`, `--mp-neutral` + soft variants).
- **Type stack** — Manrope 700/800 display (with `letter-spacing: -0.02em`), Inter 400/500/600/700 body, JetBrains Mono 400/500 tabular numbers. `font-feature-settings: "cv11", "ss01"` body.
- **Icon system** — Material Symbols Outlined with FILL variations, opsz 24. No emoji anywhere. `.msym-fill` class for filled state.
- **Radius scale** — 8px (`--mp-radius-sm`), 12px (`--mp-radius`), 18px (`--mp-radius-lg`).
- **Shadow scale** — 3-tier (`--mp-shadow-sm/md/lg`).
- **Animation primitives** — `fadeUp`, `pulseDot`, `shimmer`, `progressBar`, `spin`. Reuse for state transitions, loading, banner appearance, KPI count-up.
- **Layout patterns** — 1400px max-width container, 36–64px section vertical padding, ambient tonal radial-gradient washes (subtle, behind hero/banner zones), sticky header with `backdrop-filter: blur(12px)` and 85% bg opacity.
- **Microcopy register** — second-person singular (`tu`), uppercase letter-spaced eyebrow labels (10–11px, 0.12em tracking, 700 weight), pulse-dot status badges, sentence-case for distinguished WOW elements, anti-promissory verb selection.
- **KPI card visual treatment** — tonal-tint cards (green/red/blue soft fills), uppercase eyebrow label + 44–52px tabular display number + 12–13px subtitle + secondary `valor de catálogo` line below dividing rule.
- **PT/ES toggle pill** — same component, same styling.
- **Form inputs** — 14px medium-weight, focus state with 3px primary-tinted shadow ring, mono font for API key.
- **Button styles** — primary navy gradient (`linear-gradient(135deg, var(--mp-primary), var(--mp-primary-2))`), secondary outline, danger style for destructive actions (deletion, anomaly reject).
- **Trust-block visual treatment** — for the §5.1 primary block, identical styling to the report's prominent trust variant: green-edged box, lock icon, body+link below. Different copy, same structure.

### §10.2 Does NOT carry (Claude Design must NOT reproduce)

- **Report's 4-section narrative arc** — Status / Recover / Squeeze / Claim / CTA. The dashboard is operational; this structure does not transfer. KPI cards yes, sectional structure no.
- **"A um passo do 1.º" rocket hero card.** Report-only artifact. The dashboard has a different "what's the next action?" pattern: the Go-Live CTA panel (in dry-run state) and the Atenção feed (in live state). Do not reproduce the rocket hero.
- **Report-style table tabling** (Maiores oportunidades, Margem para subir, Vitórias rápidas). The dashboard does not have these; their data lives in the audit log Notable feed and search.
- **Decorative gradient blobs and progress glyphs from the report's static screens** — exception: scan progress page reuses the report's progress-screen pattern verbatim per UX6.
- **Long product-name table layouts.** The dashboard uses the audit log for SKU detail; the dashboard root never displays a long table of products.

### §10.3 Net guidance for Claude Design pass

> Use `MarketPilot.html` as the **token, type, icon, animation, microcopy register, and KPI card source**. Do NOT reuse its narrative-arc structure, its hero rocket card, or its three product tables. The dashboard structure comes from this skeleton's §4.2 (dashboard) and §4.1 (audit log).

---

## §11 Cross-references and traceability

Every UX requirement above traces to PRD FR/NFR. Compact mapping for downstream verification:

| UX# | Topic | Traces to |
|---|---|---|
| UX1, UX2, UX3 | Auth + onboarding state machine | FR1, FR2, FR8–FR16, NFR-S5 |
| UX4, UX5 | Banner stacking, paused-state distinction | FR32, FR39, FR43, FR46 |
| UX6 | Scan progress phases | FR12, FR13, FR14 |
| UX7–UX12 | Audit log 5-surface IA + taxonomy | FR37, FR38, NFR-S6, NFR-A3, NFR-P8 |
| UX13, UX14 | Dashboard layout + channel toggle | FR25, FR34, FR35 |
| UX15–UX21 | Margin editor mechanics | FR36, NFR-A2 |
| UX22 | Settings architecture | FR1, FR4 (amended), FR41 (amended), FR43 |
| UX23, UX24 | Trust-messaging layered system | FR11, FR29, FR31, FR32, NFR-S1 |
| UX25, UX26, UX27 | Mobile vs desktop strategy | NFR-P7, NFR-A1 |
| UX28, UX29, UX30 | Founder status page | FR6, FR47, NFR-O3 |
| UX31, UX32 | Mid-life key revocation, payment-failure interception | FR43, NFR-S1 |
| UX33, UX34 | Catalog scan readiness summary | FR12, FR15, Distillate §14 |
| UX35, UX36, UX37 | Account deletion multi-step + grace | FR4 (amended), NFR-S1 |
| UX38 | Add-marketplace concierge | FR41 (amended) |

---

## §12 Open questions

| OQ# | Question | Recommendation | Owner |
|---|---|---|---|
| OQ-1 | PT register: `tu` (singular informal, free-report continuity) vs `vós` (formal-plural, B2B legal weight)? | Skeleton uses `tu`. Switch is mechanical if Pedro prefers `vós`. | Pedro |
| OQ-2 | Margin editor: should saved margin changes apply at next cycle (UX21) or be applied retroactively to the current in-flight cycle? | Next cycle is safer (no mid-cycle behavior change). | Pedro / Winston (ARCH) |
| OQ-3 | `/admin/status` — should per-customer health rollup show customer email, or pseudonymous customer ID? | Email for MVP (3-customer cohort, founder knows them). Pseudonymize at Epic 2 if a support hire is added. | Pedro |
| OQ-4 | Anomaly review modal: should customer be able to set a per-SKU absolute cap as part of accept ("accept and never reprice this SKU again at MVP")? | No — per-SKU exclude is Epic 2 per Brief §14. Accept just unfreezes; per-SKU ignore remains pause-whole-tool. | Pedro |
| OQ-5 | Audit log Atenção feed: when items are zero, show empty-state confirmation copy (UX8) or hide the feed section entirely? | Skeleton uses confirmation copy ("Nada que precise da tua atenção"). Hiding it makes new customers think the feature is missing. | Pedro |
| OQ-6 | Trust-block "Ver as nossas garantias" link target: modal (cheaper) or `/security` page (richer)? | Modal at MVP, `/security` standalone page in Epic 2 if procurement-conscious customers ask. | Pedro |
| OQ-7 | Mobile pause button: persistent bottom action bar (UX26) — does this conflict with mobile browser chrome / iOS Safari bottom address bar? | Bottom action bar should sit above safe-area inset; verify in Pass 2 visual review. | Claude Design |

## §13 PRD amendments needed

To be applied to `_bmad-output/planning-artifacts/prd.md` after this skeleton is approved:

| Amendment | Current PRD wording | Proposed amended wording |
|---|---|---|
| **FR4** | "...The deletion request is single-click for the customer." | "...The deletion request is easily-discoverable in `/settings/delete` and uses a multi-step verification flow with a 7-day grace period before irreversible deletion. During grace period, account is suspended (cron paused, dashboard locked) but data is recoverable via founder-side cancel. Encrypted shop API key is destroyed at deletion initiation, not at grace-period end." |
| **FR41** | "Customers can add or remove marketplaces from their subscription; additions appear as new line items..." | "**MVP**: Customers cannot self-serve add/remove marketplaces. Adding a marketplace is a concierge process (customer emails founder; founder configures encrypted key + marketplace row + Stripe line item; next Moloni invoice covers the addition). Removal follows the same concierge path. **Epic 2**: Self-serve add/remove with the previously-described mid-cycle proration handling." |

These amendments are in scope for the next PRD revision and do not block this skeleton's downstream consumption.

## §14 Hand-off package for Claude Design (Pass 2 input)

When this skeleton is approved, the hand-off bundle for Claude Design is:

1. **This file** — `_bmad-output/planning-artifacts/ux-skeleton.md`
2. **PRD** — `_bmad-output/planning-artifacts/prd.md`
3. **Free-report visual DNA reference** — `/tmp/marketpilot-design/test-marketpilot/project/MarketPilot.html` (with §10 of this skeleton flagged as the binding rules for what carries vs does not)
4. **Free-report design intent transcript** — `/tmp/marketpilot-design/test-marketpilot/chats/chat1.md` (microcopy register, intellectual-honesty discipline, anti-promissory framing examples)
5. **GitHub** — DynamicPriceIdea repo for live frontend reference

Recommended Claude Design prompt skeleton (Pedro will assemble):

> Build a multi-tenant operational dashboard for MarketPilot Repricer. Visual DNA carries from the free-report MarketPilot.html (tokens, type, icons, animations, microcopy register) — see §10 of the UX skeleton for what carries vs does not. Structural source of truth is the UX skeleton at _bmad-output/planning-artifacts/ux-skeleton.md (specifically §1 sitemap, §3 screen states, §4 IA for data-dense surfaces, §9 PT microcopy). Authoritative behavior contract is the PRD at _bmad-output/planning-artifacts/prd.md. Produce HTML mockups for: (1) dashboard root in 5 states (loading, dry-run, live, paused-by-customer, paused-by-payment), (2) audit log root with 3 surfaces visible + Atenção feed populated, (3) audit log search-by-SKU result, (4) margin editor inline panel with worked-profit-example, (5) Go-Live consent modal, (6) anomaly review modal, (7) /onboarding/scan-ready, (8) /onboarding/key with primary trust block, (9) `/admin/status` founder page in admin-aesthetic register, (10) /key-revoked and /payment-failed interceptions.

After Claude Design pass, Pass 2 of this skeleton polishes microcopy and trust-treatment details against the rendered visuals.

---

*End of UX Skeleton Pass 1.*
