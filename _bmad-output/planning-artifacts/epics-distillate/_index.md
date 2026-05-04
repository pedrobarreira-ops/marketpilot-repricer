---
type: bmad-distillate
sources:
  - "../epics.md"
downstream_consumer: "bmad-create-story (Bob), bmad-dev-story (Amelia), bmad-code-review architecture-compliance auditor"
created: "2026-05-01"
parts: 8
---

## Orientation

- Source: `../epics.md` (62 stories / 12 epics, ~4013 lines).
- Distilled for `bmad-create-story` (Bob), `bmad-dev-story` (Amelia), and `bmad-code-review` architecture-compliance auditor.
- 8 parts (this _index + 7 section files).
- Pattern A/B/C visual-contract scheme applies to every UI-bearing story (Behavior = PRD FR/NFR refs; Structure = UX skeleton § refs; Visual = `design-references/screens/<NN>-<name>.html` stubs).
- 51 FRs (FR1-FR48 + FR38b/c/d) + 42 NFRs + 30 ADs + 13 amendments (F1-F13) + 38 UX-DRs covered across the 62 stories.
- 6 custom ESLint rules ship with their target SSoT modules: `no-direct-fetch` (3.1), `no-raw-CSV-building` (6.1), `no-raw-INSERT-audit-log` (9.0), `no-float-price` (7.1), single-source-of-truth cron-state rule (4.1), `worker-must-filter-by-customer` (5.1).

## Section Manifest

- `01-epics-1-3-foundation-tenancy-mirakl.md` — Epic 1 Foundation & Trust Primitives (5 stories: 1.1–1.5), Epic 2 Multi-Tenant Isolation (2 stories: 2.1–2.2), Epic 3 Mirakl Integration Foundation (3 stories: 3.1–3.3) — 10 stories
- `02-epic-4-onboarding.md` — Epic 4 Customer Onboarding (9 stories: 4.1–4.9)
- `03-epics-5-6-cron-pri01.md` — Epic 5 Cron Dispatcher & State Machine (2 stories: 5.1–5.2), Epic 6 PRI01 Writer Plumbing (3 stories: 6.1–6.3) — 5 stories
- `04-epic-7-engine-safety.md` — Epic 7 Engine Decision & Safety (8 stories: 7.1–7.8)
- `05-epic-8-dashboard.md` — Epic 8 Customer Dashboard & Surfaces (12 stories: 8.1–8.12)
- `06-epics-9-10-audit-deletion.md` — Epic 9 Audit Log (7 stories: 9.0–9.6), Epic 10 Account Deletion & Grace (3 stories: 10.1–10.3) — 10 stories
- `07-epics-11-12-billing-ops.md` — Epic 11 Billing — Stripe & Moloni (5 stories: 11.1–11.5), Epic 12 Operations & Failure Model (3 stories: 12.1–12.3) — 8 stories

**Total: 62 stories** (5 + 2 + 3 + 9 + 2 + 3 + 8 + 12 + 7 + 3 + 5 + 3 = 62).

## Cross-Cutting: Atomicity Bundles

- **Bundle A** — Story 1.4 (signup atomic profile trigger). F3 + AD29 ship as a single PR — schema migration + Postgres trigger (`SECURITY DEFINER` on `auth.users` AFTER INSERT) + endpoint + JSON Schema validation + safe-error mapping for trigger HINT field, all in one commit. Atomicity invariant: signup never lands in orphan-auth-without-profile state.
- **Bundle B** — Multiple stories: Story 4.2 (skus + sku_channels + baseline_snapshots + scan_jobs schemas; engine logic continues in Epic 7), Story 8.1 (dashboard chrome surface; interception-redirect logic; banner library consumer), Story 10.1 (multi-step deletion + Stripe `cancel_at_period_end` + key destruction must happen in ONE transaction), Story 11.5 (`moloni_invoices` retained on customer deletion via FK NO ACTION; coordinated with Story 10.3 hard-delete), Story 12.1 (sustained-transient counter + audit emission must be transactional with cycle outcome).
- **Bundle C** — Stories 5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.6 — gate at **Story 7.8**. AD7 (Epic 6 writer) + AD8 + AD9 + AD11 ship through a single integration-test gate at the end of Epic 7. The gate test asserts all in-flight PRI01 batch rows have non-NULL `pending_import_id` matching the same `import_uuid`, exercising the full cycle on all 17 P11 fixtures against the Mirakl mock server seeded with `verification-results.json`. Epic 6's writer code becomes safe to ship to production only after this gate passes. Atomicity invariants: engine cannot push prices that violate the writer's pending_import_id contract or the cooperative-absorption skip-on-pending.

## Cross-Cutting: Calendar-Early Sequencing

- **Stories 9.0 + 9.1 ship between Epic 2 and Epic 3 — NOT in Epic 9 timeline.** Reason: audit-log infrastructure (event_types lookup, partitioned `audit_log` table, priority-derivation trigger, `writeAuditEvent` SSoT, `no-raw-INSERT-audit-log` ESLint rule, monthly partition cron) is needed before Epic 3+ events fire. Epics 5, 7, 10, 11, 12 all emit audit events; the foundation must exist when those epics ship.
- Markers: `[CALENDAR-EARLY — Story 1.x sibling]` annotations on Stories 9.0 and 9.1.
- **Story 5.1 BAD-subagent retrofit pragma:** Story 9.1's `monthly-partition-create.js` cron uses Story 5.1 cron dispatcher with the literal `// safe: cross-customer cron` comment opt-out from the `worker-must-filter-by-customer` ESLint rule. This is preserved verbatim on Story 5.1 AND cross-referenced on Story 9.1.

## Cross-Cutting: 17 P11 Fixtures

All 17 P11 fixtures consumed by Epic 7 stories; ALL 17 in Story 7.8 integration gate.

| Fixture filename | Consumed by |
|---|---|
| `p11-tier1-undercut-succeeds.json` | Story 7.2, Story 7.8 |
| `p11-tier1-floor-bound-hold.json` | Story 7.2, Story 7.8 |
| `p11-tier1-tie-with-competitor-hold.json` | Story 7.2, Story 7.8 |
| `p11-tier2b-ceiling-raise-headroom.json` | Story 7.2, Story 7.8 |
| `p11-all-competitors-below-floor.json` | Story 7.2, Story 7.8 |
| `p11-all-competitors-above-ceiling.json` | Story 7.2, Story 7.8 |
| `p11-self-active-in-p11.json` | Story 7.2, Story 7.8 |
| `p11-self-marked-inactive-but-returned.json` | Story 7.2, Story 7.8 |
| `p11-single-competitor-is-self.json` | Story 7.2, Story 7.8 |
| `p11-zero-price-placeholder-mixed-in.json` | Story 7.2, Story 7.8 |
| `p11-shop-name-collision.json` | Story 7.2, Story 7.8 |
| `p11-pri01-pending-skip.json` | Story 7.2, Story 7.8 |
| `p11-cooperative-absorption-within-threshold.json` | Story 7.3, Story 7.8 |
| `p11-cooperative-absorption-anomaly-freeze.json` | Story 7.4, Story 7.8 |
| `p11-tier2a-recently-won-stays-watched.json` | Story 7.5, Story 7.8 |
| `p11-tier3-no-competitors.json` | Story 7.5, Story 7.8 |
| `p11-tier3-then-new-competitor.json` | Story 7.5, Story 7.8 |

## Cross-Cutting: SSoT Modules Index

- `shared/crypto/envelope.js` (Story 1.2 builds) → consumed by Story 4.3 (key vault), Story 4.4 (decrypt for scan), Story 10.1 (destruction at deletion initiation), Story 11.4 (concierge add)
- `shared/crypto/master-key-loader.js` (Story 1.2)
- `shared/logger.js` (Story 1.3) → all subsequent stories that emit logs
- `shared/db/rls-aware-client.js`, `shared/db/service-role-client.js`, `shared/db/tx.js`, `app/src/middleware/rls-context.js` (Story 2.1) → every customer-scoped feature
- `shared/mirakl/api-client.js` (`mirAklGet`, `MiraklApiError`) (Story 3.1) → every Mirakl-touching story
- `shared/mirakl/safe-error.js` (`getSafeErrorMessage`) (Story 3.1)
- `shared/mirakl/a01.js`, `pc01.js`, `of21.js`, `p11.js`, `self-filter.js`, `tests/mocks/mirakl-server.js` (Story 3.2)
- `scripts/mirakl-empirical-verify.js` (Story 3.3)
- `shared/state/cron-state.js` (`transitionCronState`), `shared/state/transitions-matrix.js` (`LEGAL_CRON_TRANSITIONS`) (Story 4.1) → consumed by Stories 5.1, 7.6, 8.5, 8.6, 8.9, 10.1, 10.2, 11.2
- `worker/src/jobs/onboarding-scan.js`, `worker/src/lib/tier-classify.js` (Story 4.4)
- `shared/resend/client.js` (`sendCriticalAlert`) (Story 4.6 minimal SSoT) → extended by Story 12.2 with templates
- `worker/src/dispatcher.js`, `worker/src/advisory-lock.js`, `worker/src/jobs/master-cron.js` (Story 5.1)
- `worker/src/cycle-assembly.js` (Story 5.2)
- `shared/mirakl/pri01-writer.js` (`buildPri01Csv`, `submitPriceImport`, `markStagingPending`) (Story 6.1) → consumed by Story 7.x writer flush
- `shared/mirakl/pri02-poller.js`, `worker/src/jobs/pri02-poll.js` (Story 6.2)
- `shared/mirakl/pri03-parser.js` (Story 6.3)
- `shared/money/index.js` (`toCents`, `fromCents`, `roundFloorCents`, `roundCeilingCents`, `formatEur`) (Story 7.1) → engine STEP 3 + Epic 8 eta templates
- `worker/src/engine/decide.js` (`decideForSkuChannel`) (Story 7.2)
- `worker/src/engine/cooperative-absorb.js` (Story 7.3)
- `worker/src/safety/anomaly-freeze.js`, `app/src/routes/audit/anomaly-review.js` (Story 7.4)
- `worker/src/engine/tier-classify.js` (`applyTierClassification`) (Story 7.5)
- `worker/src/safety/circuit-breaker.js` (Story 7.6)
- `worker/src/safety/reconciliation.js`, `worker/src/jobs/reconciliation.js` (Story 7.7)
- `shared/audit/writer.js` (`writeAuditEvent`), `shared/audit/event-types.js` (Story 9.0) → all event-emitting stories
- `worker/src/jobs/monthly-partition-create.js` (Story 9.1)
- `worker/src/jobs/daily-kpi-aggregate.js`, `worker/src/engine/kpi-derive.js` (Story 9.2)
- `shared/audit/readers.js` (Story 9.3)
- `worker/src/jobs/audit-log-archive.js` (Story 9.6)
- `worker/src/jobs/deletion-grace.js` (Story 10.3)
- `shared/stripe/subscriptions.js` (Story 11.1) → consumed by Stories 8.6, 10.1, 11.4, 11.2
- `shared/stripe/webhooks.js` (Story 11.2)
- `shared/stripe/customer-portal.js` (Story 11.3)
- `scripts/concierge-add-marketplace.js` (Story 11.4)
- `shared/moloni/invoice-metadata.js` (`recordMoloniInvoice`) (Story 11.5)
- `worker/src/safety/failure-classifier.js`, `worker/src/safety/sustained-transient-detector.js` (Story 12.1)
- `worker/src/jobs/pc01-monthly-repull.js` (Story 12.3)

## Requirements Inventory (compressed)

### FRs

- **FR1** Self-serve signup with email verification.
- **FR2** Single login per customer at MVP; multi-user RBAC = Phase 2.
- **FR3** Email-verified password reset.
- **FR4** Multi-step account deletion + 7-day soft-delete grace + GDPR Art 17 hard-delete; key destroyed at INITIATION; Moloni invoice metadata retained.
- **FR5** RLS at DB layer.
- **FR6** Founder admin read-only operational queries.
- **FR7** Source-context query params persist on customer record.
- **FR8** Single-purpose API key entry form during onboarding.
- **FR9** Inline 5s P11 validation against reference EAN.
- **FR10** "How to find your Worten Marketplace API key" guide modal.
- **FR11** Encrypted-at-rest API key, no founder cleartext, no logs.
- **FR12** Async catalog scan reads catalog and snapshots baseline pricing.
- **FR13** Closeable progress page with reconnect.
- **FR14** Server-side scan job state.
- **FR15** Email on scan failure; healthy completion silent.
- **FR16** Single onboarding margin-band question + smart-default mapping.
- **FR17** Per-SKU per-channel state with tier + last_won_at + tier_cadence_minutes.
- **FR18** 4-state tier system + per-SKU cadence; single 5-min cron.
- **FR19** Tier transitions including F1 atomic T2a→T2b write.
- **FR20** P11 ranking + active+total_price+self filter chain.
- **FR21** Per-SKU floor/ceiling math.
- **FR22** Cooperative-ERP-sync absorption (skip-on-pending).
- **FR23** PRI01-only writes; PRI02 polling; PRI03 partial-success rebuild.
- **FR24** AD8 full decision table.
- **FR25** Per-channel repricing (Worten PT vs ES).
- **FR26** Per-SKU 15% + per-cycle 20% circuit breakers.
- **FR27** Circuit-breaker freeze + manual unblock.
- **FR28** Nightly reconciliation = Tier 3 daily.
- **FR29** Anomaly freeze on >40% external deviation.
- **FR30** Dry-run by default.
- **FR31** Go-Live consent modal with conditional language.
- **FR32** Pause/resume single-click.
- **FR33** Pre-tool baseline snapshot retained.
- **FR34** KPI cards on dashboard.
- **FR35** PT/ES channel toggle.
- **FR36** Margin editor with worked-profit-example.
- **FR37** Per-customer-per-channel audit log.
- **FR38** Audit log filter by channel/SKU/event-type.
- **FR38b** 5-surface hierarchical IA.
- **FR38c** Firehose cycle-aggregated.
- **FR38d** Three priority levels (atencao/notavel/rotina).
- **FR39** PT-localized banner during sustained transient issues.
- **FR40** €50/month/marketplace Stripe subscription on Go-Live.
- **FR41** MVP single marketplace; concierge-only at MVP; Phase 2 self-serve.
- **FR42** 14-day money-back; ZERO dev stories (Legal + Operational tracks).
- **FR43** Stripe-managed dunning; auto-cancel + cron paused on final failure.
- **FR44** Founder generates manual Moloni invoices with NIF/IVA.
- **FR45** /health endpoint pinged by UptimeRobot 5-min.
- **FR46** 3-tier failure model (transient/sustained/critical).
- **FR47** Founder admin status page (read-only).
- **FR48** Critical alerts ≤5min via email.

### NFRs

Performance: NFR-P1 T1 ≤18min; NFR-P2 T2a ≤18min; NFR-P3 T2b ≤75min; NFR-P4 T3 ≤28h; NFR-P5 PRI01→PRI02 ≤30min; NFR-P6 5s key validation; NFR-P7 dashboard ≤2s/4s; NFR-P8 audit ≤2s 90-day; NFR-P9 critical alert ≤5min; NFR-P10 50k SKUs in 4h.
Security: NFR-S1 KMS-managed envelope encryption; NFR-S2 TLS 1.2+; NFR-S3 RLS at Postgres; NFR-S4 Stripe webhook signature + replay; NFR-S5 Supabase Auth defaults; NFR-S6 audit-log append-only; NFR-S7 no card data stored.
Scalability: NFR-Sc1 5-10 customers MVP; NFR-Sc2 50k SKUs MVP; NFR-Sc3 advisory locks; NFR-Sc4 Resend free tier; NFR-Sc5 Supabase Cloud free tier.
Reliability: NFR-R1 99% uptime; NFR-R2 30-min RTO; NFR-R3 24h RPO; NFR-R4 3-tier failure model; NFR-R5 PT-localized banner within 3 cycles.
Integration: NFR-I1 Mirakl rate-limit; NFR-I2 Stripe idempotency; NFR-I3 RLS regression per deploy; NFR-I4 Resend PT templates; NFR-I5 UptimeRobot config; NFR-I6 cross-repo handoff with DynamicPriceIdea.
Accessibility: NFR-A1 WCAG 2.1 AA; NFR-A2 keyboard accessibility; NFR-A3 audit log screen-reader-readable.
Localization: NFR-L1 PT default; NFR-L2 ES Phase 2.
Operational: NFR-O1 rollback playbook; NFR-O2 continuity runbook; NFR-O3 Day-1 monitoring protocol; **NFR-O4 manual Moloni invoice 24h SLA, ≤10min/invoice, 2-3hr/month aggregate trigger**.

### Additional Requirements

ADs: AD1 two services; AD2 RLS isolation; AD3 envelope encryption + rotation; AD4 founder admin read-only; AD5 Mirakl HTTP client; AD6 per-channel pricing; AD7 PRI01 writer; AD8 engine decision table; AD9 cooperative absorption; AD10 4-state tier + cadence (with F1); AD11 outbound circuit breaker (with F6); AD12 inbound anomaly freeze; AD13 self-filter; AD14 mandatory P11 filter chain; AD15 cron_state machine (with F4 + F13); AD16 onboarding scan sequence (with F4); AD17 dispatcher + advisory locks; AD18 polling-only (no webhooks — constraint); AD19 audit log partitioning + aggregates (with F8); AD20 event-type taxonomy (with F5); AD21 deletion 4-step + grace; AD22 Stripe + Moloni (with F2 + F7 + F12); AD23 /health composition; AD24 3-tier failure model (with F10); AD25 Resend critical alerts; AD26 PC01 monthly re-pull; AD27 pino logging + redaction; AD28 Fastify built-in JSON Schema (constraint); AD29 atomic auth+profile (with F3); AD30 RLS regression suite.

F-amendments: F1 T2a→T2b atomic write; F2 Stripe model corrected; F3 atomic auth+profile via SECURITY DEFINER trigger; F4 PROVISIONING + nullable A01/PC01 + CHECK constraint; F5 audit_log_event_types lookup migration ordering; F6 circuit-breaker per-cycle 20% denominator clarified; F7 NIF capture flow at Day-3 pulse-check; F8 audit_log.sku_id + sku_channel_id NO FK; F9 per-page script `defer` near body; F10 sustained-transient threshold hardcoded; F11 worker `replicas: 1` at MVP; F12 Stripe linkage layout corrected post-F2; F13 cron_state UPPER_SNAKE_CASE.

### UX-DRs (38)

UX-DR1 auth ?next= preservation; UX-DR2 onboarding forward-only; UX-DR3 returning customer landing + interception; UX-DR4 banner stacking precedence; UX-DR5 paused-state distinction (calm grey vs warning amber); UX-DR6 5-phase scan progress; UX-DR7 daily summary card clickable; UX-DR8 Atenção feed expanded by default; UX-DR9 Notável feed collapsed-by-default + per-channel chip; UX-DR10 sticky-top search-by-SKU primary investigation; UX-DR11 firehose opt-in + cycle-paginated 50/page; UX-DR12 trust property — every event accessible; UX-DR13 KPI card visual treatment carries from report (no narrative arc); UX-DR14 channel toggle single-select MVP; UX-DR15 representative-SKU rule; UX-DR16 "Ver outro" cycles top 5; UX-DR17 empty-state when no candidate SKUs; UX-DR18 stated-margin assumption floor of band; UX-DR19 assumption explicitly displayed; UX-DR20 live update 150ms debounce; UX-DR21 explicit save action + toast; UX-DR22 settings sectioned nav (sidebar/accordion); UX-DR23 primary trust block at /onboarding/key; UX-DR24 secondary trust evidence in operational UI; UX-DR25 desktop ≥1280px primary; UX-DR26 mobile-first surfaces (critical-alert glance, Atenção entry detail, Pause ≤2 taps); UX-DR27 mobile chrome strips toggle/editor/sidebar/firehose; UX-DR28 admin status read-only; UX-DR29 admin deliberately different visual register; UX-DR30 admin reuses customer audit log via ?as_admin; UX-DR31 key-revoked rotation → return to dashboard healthy; UX-DR32 payment-failed first-time interception only; UX-DR33 scan-ready interstitial; UX-DR34 "porquê?" disclosure on refurbished OOS; UX-DR35 4-step deletion + ELIMINAR + key destroyed at INITIATION; UX-DR36 grace-period banner + read-only mode; UX-DR37 PT-localized confirmation email; UX-DR38 add-marketplace concierge tooltip.

### NFR-O4 Binding

**NFR-O4 → Story 11.5.** Moloni manual-invoice 24h SLA, ≤10min/invoice, 2-3hr/month aggregate Moloni-API Phase 2 trigger. NFR-O4 is operational-tier work supported by Story 11.5's `recordMoloniInvoice` admin route; the SLA itself is a founder commitment, the supporting tooling is dev work. Both layers are covered.

## Coverage Maps

### FR Coverage (every FR1-FR48 + FR38b/c/d → story mapping)

```
A. Account & Identity (FR1-FR7)
  FR1  → Story 1.4
  FR2  → Story 1.4 (negative-assertion)
  FR3  → Story 1.4
  FR4  → Stories 10.1 + 10.2 + 10.3
  FR5  → Stories 2.1 + 2.2
  FR6  → Stories 1.5 + 8.10
  FR7  → Story 1.4

B. API Key & Catalog Onboarding (FR8-FR16)
  FR8-FR11 → Story 4.3
  FR12-FR15 → Stories 4.4 + 4.5 + 4.6
  FR16 → Story 4.8

C. Pricing Engine (FR17-FR25)
  FR17 → Stories 4.2 + 7.x
  FR18 → Story 5.1
  FR19 → Story 7.5
  FR20 → Story 7.2
  FR21 → Story 7.2
  FR22 → Story 7.3
  FR23 → Stories 6.1 + 6.2 + 6.3
  FR24 → Story 7.2
  FR25 → Stories 4.2 + 7.2 + 8.3

D. Engine Safety & Customer Controls (FR26-FR33)
  FR26-FR27 → Story 7.6
  FR28 → Story 7.7
  FR29 → Stories 7.4 + 8.7
  FR30 → Stories 4.9 + 8.1
  FR31 → Story 8.6
  FR32 → Story 8.5
  FR33 → Story 4.2

E. Dashboard & Audit Log (FR34-FR39 + FR38b/c/d)
  FR34 → Stories 8.1 + 8.2 + 9.2
  FR35 → Story 8.3
  FR36 → Story 8.4
  FR37 → Stories 9.3 + 9.4 + 9.5
  FR38 → Stories 9.3 + 9.4
  FR38b → Story 9.3
  FR38c → Story 9.5
  FR38d → Stories 9.0 + 9.3
  FR39 → Stories 8.8 + 12.1

F. Subscription & Billing (FR40-FR44)
  FR40 → Story 11.1
  FR41 MVP → Stories 11.4 + 8.11
  FR42 → Parallel Tracks (Legal + Founder Operational); ZERO dev stories
  FR43 → Stories 11.2 + 11.3
  FR44 → Story 11.5

G. Operations & Alerting (FR45-FR48)
  FR45 → Story 1.1
  FR46 → Story 12.1
  FR47 → Stories 1.5 + 8.10
  FR48 → Stories 4.6 + 12.2

NFR-O4 → Story 11.5 (Moloni manual-invoice 24h SLA + admin route)
```

### AD Coverage (AD1-AD30 → story mapping)

```
AD1  → Story 1.1
AD2  → Stories 2.1 + 2.2
AD3  → Story 1.2
AD4  → Stories 1.5 + 8.10
AD5  → Story 3.1
AD6  → Story 4.1
AD7  → Stories 6.1 + 6.2 — gate at Story 7.8
AD8  → Story 7.2
AD9  → Story 7.3
AD10 → Stories 4.1 + 7.5 (with F1)
AD11 → Story 7.6 (with F6)
AD12 → Story 7.4
AD13 → Stories 3.2 + 7.2
AD14 → Stories 3.2 + 7.2
AD15 → Stories 4.1 + 5.1 + 8.8
AD16 → Story 4.4 (with F4)
AD17 → Story 5.1
AD18 → Story 1.1 negative assertion (Architectural Constraints #1)
AD19 → Stories 9.1 + 9.2 + 9.6
AD20 → Story 9.0 (extended by Stories 12.1 + 12.3)
AD21 → Stories 10.1 + 10.2 + 10.3
AD22 → Stories 11.1 + 11.2 + 11.5 (with F2 + F7 + F12)
AD23 → Story 1.1
AD24 → Stories 6.3 + 12.1 + 12.2 (with F10)
AD25 → Stories 4.6 + 12.2
AD26 → Story 12.3
AD27 → Story 1.3
AD28 → Story 1.1 negative assertion (Architectural Constraints #2)
AD29 → Story 1.4 (with F3)
AD30 → Story 2.2
```

### F1-F13 Amendments → story mapping

```
F1  → Story 7.5 (T2a→T2b atomic write)
F2  → Story 11.1 (Stripe one-Customer + one-Subscription model)
F3  → Story 1.4 (Postgres trigger SECURITY DEFINER — atomicity bundle)
F4  → Stories 4.1 + 4.4 (PROVISIONING + CHECK + scan population — atomicity bundle)
F5  → Story 9.0 (audit_log_event_types lookup migration ordering)
F6  → Story 7.6 (per-cycle 20% denominator clarified)
F7  → Stories 11.5 + Founder Operational track (NIF capture)
F8  → Story 9.1 (audit_log no-FK on sku_id/sku_channel_id)
F9  → Story 1.1 + per-page eta (no-bundler defer)
F10 → Story 12.1 (sustained-transient hardcoded 3-cycle)
F11 → Story 1.1 (worker replicas: 1)
F12 → Story 11.1 (Stripe linkage post-F2)
F13 → Story 4.1 (cron_state UPPER_SNAKE_CASE)
```

### UX-DR Coverage (UX-DR1-38 → story mapping)

```
UX-DR1  → Story 1.4
UX-DR2  → Stories 4.3, 4.5, 4.7, 4.8, 4.9, 8.1
UX-DR3  → Stories 4.6, 8.1, 8.9
UX-DR4-5 → Story 8.8
UX-DR6  → Story 4.5
UX-DR7-12 → Stories 9.3, 9.4, 9.5
UX-DR13-14 → Stories 8.1, 8.2, 8.3
UX-DR15-21 → Story 8.4
UX-DR22 → Story 8.11
UX-DR23-24 → Stories 4.3 + secondary across operational UI
UX-DR25-27 → Stories 8.1, 8.12
UX-DR28-30 → Story 8.10
UX-DR31 → Story 8.9
UX-DR32 → Story 8.9
UX-DR33-34 → Story 4.7
UX-DR35-37 → Stories 10.1, 10.2
UX-DR38 → Story 8.11
```

### Story-dependency check

Verified: every story's `Depends on:` line references only PRIOR-numbered stories (within the epic) OR stories from earlier epics (calendar-shipping order). Exception correctly documented: Story 9.0 + Story 9.1 ship calendar-early as Story 1.x siblings per Option A — this is the ONLY out-of-numerical-order shipping in the spec.

## Architectural Constraints / Negative Assertions (27 items)

> **Note on enforcement timing.** ~11 of the 27 constraints rely on ESLint custom rules that ship WITH their target SSoT modules per the refined sequencing pattern. Until those stories ship, the constraints they protect are review-enforced rather than mechanically-enforced. Bob's sprint-status sequencing makes the ramp-up explicit; once the rule lands, retroactive enforcement against existing stories is automatic at next CI run.

1. **No Mirakl webhook listener** in the codebase (AD18) — Story 1.1 negative assertion (grep `package.json` + source). Seller-side webhooks unavailable per MCP — polling-only architecture.
2. **No external validator library** — Fastify built-in JSON Schema only (AD28) — Story 1.1 negative assertion (no `zod`, `yup`, `joi`, `ajv` in `package.json`). Sufficient for MVP signup/key-entry/margin/anomaly-review/Stripe webhook payload validation; lib added in Phase 2 only if surface emerges that JSON Schema can't express ergonomically.
3. **No SPA framework** — Story 1.1 negative assertion (no `react`, `vue`, `svelte`, `angular`, `solid-js` in `package.json`). Server-rendered eta + per-page vanilla JS preserves DynamicPriceIdea's velocity datapoint and matches NFR-P7 mobile budget.
4. **No bundler** — Story 1.1 negative assertion (no `vite`, `webpack`, `rollup`, `esbuild`, `parcel` in `package.json`). Coolify runs `node app/src/server.js` directly; no build step; per-page `<script src="/js/<page>.js" defer>` per F9. The `defer` attribute pattern itself is review-only at MVP — no automated CI gate scans rendered HTML for missing `defer`. Code review during Epic 8 PR-merge enforces. Phase 2 trigger to add a Playwright assertion if the pattern drifts.
5. **No TypeScript at MVP** — Story 1.1 negative assertion (no `typescript`, `ts-node` in `package.json`). JS-ESM with JSDoc type hints matches DPI shared-code reuse; TS migration is `*.js → *.ts` rename + cleanup, Phase 2 trigger if churn demands.
6. **OF24 forbidden for price updates** (CLAUDE.md mandate) — Story 6.1 PRI01 writer is the SSoT path; ESLint `no-raw-CSV-building` flags any parallel writer; grep verifies no `POST /api/offers` price calls exist. OF24 resets ALL unspecified offer fields (quantity, description, leadtime) to defaults — confirmed footgun.
7. **No customer-facing API at MVP** (PRD Journey 5 N/A through Epic 2 / Phase 2) — Story 1.1 negative assertion (no `/api/v1/...` routes); Stripe webhook is the only JSON-accepting route. Reopens Phase 3+ if ≥2 paying customers request audit-log export OR programmatic margin updates.
8. **No Redis / BullMQ / external queue** — Story 1.1 negative assertion (no `redis`, `ioredis`, `bullmq`, `bull` in `package.json`). `pri01_staging` table + Postgres advisory locks (Story 5.1) are the queue equivalent at MVP; Phase 2 trigger when cycle latency exceeds NFR-P1/P2 budgets.
9. **No CDN in front of public/** — Story 1.1 deployment topology (`@fastify/static` serves directly). Phase 2 trigger if dashboard rendering latency becomes customer-visible at PT/ES geo-concentration with Hetzner Frankfurt; Cloudflare in front of Coolify is config-only.
10. **No ES UI translation at MVP** (NFR-L2) — Story 1.1 negative assertion (no `i18n` infrastructure, no ES translation files); Story 4.x onboarding + Story 8.x dashboard are PT-only. Phase 2 trigger when a primary-ES customer signs up.
11. **No worker connection pooler beyond `pg`'s built-in** — Story 1.1 negative assertion (no `pgbouncer`-as-deployed, no `supavisor` config). At MVP scale (5-10 customers, single worker, 5-min cycles), `pg` Pool with `max: 5` is sufficient; Phase 2 trigger when worker count exceeds 1.
12. **No mobile-optimized surfaces beyond critical-alert response** (UX-DR25-27) — Story 8.12 ships only the mobile critical-alert response surface; Stories 8.1-8.11 target ≥1280px primary, render acceptably to ~960px, mobile-degraded below 768px. Operational tasks (audit log filtering, margin editor with worked-profit-example, channel toggle for PT/ES comparison, founder admin) are structurally desktop work.
13. **No customer impersonation by founder** (AD4 + UX-DR28-30) — Story 1.5 + Story 8.10 — `/admin/status` is read-only; `/audit?as_admin={customer_id}` reuses customer-side audit log via service-role bypass with red admin-mode banner; founder NEVER logs in as the customer. Trust commitment + GDPR posture.
14. **No FK constraint on `audit_log.sku_id` and `sku_channel_id`** (F8) — Story 9.1 inline schema comment. Preserves audit history if a SKU is later removed from catalog; immutability per NFR-S6 trumps referential integrity to ephemeral catalog rows.
15. **No `moloni_invoices` CASCADE on customer deletion** — Story 11.5 schema (`ON DELETE NO ACTION`). Fiscal record per AD22 / Portuguese statutory retention — survives FR4 hard-delete; founder migrates rows to a fiscal archive before customer deletion if needed.
16. **No team-membership table at MVP** (FR2 negative assertion) — Story 1.4 — schema does NOT include `customer_team_members` or equivalent; one auth.users → one customers → one customer_profiles (1:1:1). Single-login-per-customer-account at MVP; multi-user RBAC = Phase 2.
17. **No fiscal-evidence exception in audit_log retention** (Pedro's clarification) — Story 10.3 hard-delete cron + Story 9.6 archive coordination. Zero `audit_log` rows retained on T+7d hard-delete; fiscal evidence lives in `moloni_invoices` (separate table, separate retention).
18. **No `console.log` in production code** — Story 1.1 ESLint `no-console` rule + Story 1.2 secret-scanning hook. All output via `pino` per AD27.
19. **No direct `fetch` outside `shared/mirakl/` directory** — Story 3.1 custom ESLint rule `no-direct-fetch`. One Mirakl HTTP path; allows `api-client.js` (GET) + `pri01-writer.js` (multipart POST) — no other POST endpoints exist.
20. **No raw CSV building outside `shared/mirakl/pri01-writer.js`** — Story 6.1 custom ESLint rule `no-raw-CSV-building`. One PRI01 emission path; AD7 per-SKU aggregation + delete-and-replace + pending_import_id atomicity all in one place.
21. **No raw `INSERT INTO audit_log` outside `shared/audit/writer.js`** — Story 9.0 custom ESLint rule `no-raw-INSERT-audit-log`. One audit emission path; trigger-derived priority + structured payload via `@typedef PayloadFor<EventType>`.
22. **No float-price math outside `shared/money/index.js`** — Story 7.1 custom ESLint rule `no-float-price`. One money path; integer-cents discipline + conservative rounding (Math.ceil floor / Math.floor ceiling).
23. **No raw `UPDATE customer_marketplaces SET cron_state` outside `shared/state/cron-state.js`** — Story 4.1 custom ESLint rule. One state-machine path; legal-transitions matrix + per-(from,to) audit event lookup + optimistic-concurrency guard.
24. **No worker query missing `customer_marketplace_id` filter** (RLS bypassed in worker) — Story 5.1 custom ESLint rule `worker-must-filter-by-customer`. Explicit cross-customer queries require `// safe: cross-customer cron` comment to suppress.
25. **No refurbished products on Worten** — Architecture explicitly out of scope — distillate §14; do NOT propose stories addressing refurbished SKUs. Worten has no shared EAN catalog for seller-created refurbished listings; engine would tier-classify them T3 forever; structural to Worten, not a MarketPilot limitation.
26. **No multi-marketplace beyond Worten at MVP** — Story 11.4 concierge-add limited to operator='WORTEN'; `marketplace_operator` enum has only `'WORTEN'` value at MVP. Phase 2 extends enum to add Phone House, Carrefour ES, PCComponentes, MediaMarkt.
27. **No self-serve "Add Marketplace" UI** (FR41 MVP) — Story 8.11 `/settings/marketplaces` shows read-only list with concierge tooltip; no form/wizard. Phase 2 trigger ships self-serve add/remove with Stripe proration UI.

## Parallel Tracks

### Legal Track (pre-revenue gates)

Pre-revenue legal review is fixed-fee (not retainer), funded from runway, post-build pre-Go-Live — single engagement covering all four items below. Founder schedules this once MVP is feature-complete and before customer #1's first invoice.

- **ToS update for price-setting agency** — The free-report ToS does NOT cover automated price-setting agency on customer's behalf (per distillate §15). New ToS must explicitly cover this scope + the customer-self-flips-Go-Live + audit-log-as-trust-deliverable architecture. (Status: existing free-report ToS in DynamicPriceIdea repo; needs replacement.)
- **B2B DPA template** — For procurement-conscious B2B customers (per distillate §15); standard GDPR DPA covering Supabase Cloud EU + Hetzner data flow. (Status: not drafted.)
- **Refund-policy ToS clause** (FR42) — "First-month money-back guarantee within 14 days of Go-Live, no questions asked" stated explicitly; aligns with dry-run-by-default + 24h post-Go-Live monitoring. (Status: concept locked in distillate §1; ToS clause to be drafted.)
- **Worten/Mirakl operator-ToS compatibility check** — Confirm automated repricing via `shop_api_key` is consistent with Worten's seller agreement (per distillate §15). UNVERIFIED — could be a hidden blocker. (Status: not verified.)

**FR42 dev-story status:** ZERO customer-facing dev stories per Pedro's directive. The policy is the ToS clause above; the operational refund process is in the Founder Operational track below.

### Founder Operational Track (runbooks)

Drafted before customer #1, runs in parallel to MVP build.

- **Rollback playbook** — 30-min response target from critical alert to customer-facing action (triage → alert customer → diagnose → fix or revert); includes Coolify one-click previous-image revert procedure. (NFR-O1, NFR-R2; Pedro before customer #1.)
- **Solo-founder continuity runbook** (1-page) — Laptop loss, hospitalization, extended absence scenarios; 1Password recovery, Hetzner/Supabase/Stripe credentials access procedures. (NFR-O2; Pedro before customer #1.)
- **Day-1 active-monitoring protocol** — First 24h post-Go-Live per customer: audit-log tail + uptime status + 2-hour response SLA during launch week. (NFR-O3; Pedro before customer #1.)
- **Day-3 pulse-check NIF-capture script** (per F7) — Email script: *"Posso enviar a fatura Moloni para o NIF da {company}?"*; founder records NIF via `/admin/moloni-record` (Story 11.5). (F7 / AD22; Pedro before customer #1.)
- **Day-7 pulse-check protocol** — Outbound call or email check-in; documents customer satisfaction + Atenção feed review + any cooperative-absorption events. (NFR-O3; Pedro before customer #1.)
- **Refund-process-via-Stripe-Dashboard runbook** (FR42 operational half) — Customer requests 14-day refund → founder issues full-amount refund via Stripe Dashboard manually → updates `moloni_invoices` row with refund-credit-note metadata; documented; no code. (FR42; Pedro before customer #1.)
- **Master-key rotation ceremony** (already in Story 1.2 as `scripts/rotate-master-key.md`) — Annual rotation procedure per AD3; on-incident rotation if compromise suspected. (NFR-S1; Story 1.2 ships the runbook; Pedro executes annually.)
- **UptimeRobot configuration** — Monitor for `/health` 5-min cadence with founder-email failure alert (per FR45 + NFR-I5); manual setup via UptimeRobot UI; documented in ops runbook. (FR45, NFR-I5; Pedro post-Story 1.1 deploy.)

### Screen → Stub Mapping (27 rows / 17 UI surfaces)

> Directory walked and table populated by Sally on 2026-04-30. All (TBD) prefixes resolved. Stubs 01–16 + 06b were already shipped (Phases B + C + content); stubs 17–25 generated mechanically as Spec stubs (no Claude Design canvas backing yet — implementation uses skeleton sections + visual-DNA tokens). Stub 26 (`26-dashboard-dryrun-minimal.html`) added to lock Story 4.9's stripped landing as distinct from Epic 8's full DRY_RUN state.

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

**Pattern accounting verified:** 17 Pattern A surfaces + 2 Pattern B + 10 Pattern C = 29 distinct UI surfaces total. Pedro's directive 2 said 17 + 2 + 10 = 29.

**Pattern accounting clarifier:** 17 Pattern A surfaces fan out to 27 rows due to multi-state surfaces (dashboard root has 9 state-variant rows: loading, dry-run-minimal, dry-run-full, live, paused-customer, paused-payment, anomaly-attention, circuit-breaker, sustained-transient; audit log has 3: root, search, firehose). The "17 + 2 + 10 = 29" total counts surfaces; the table counts rows for BAD subagent implementation clarity (each state-variant gets its own visual reference). Both views are consistent.

## Notes for Pedro to Relay Back to Winston (18 entries)

1. **"16 fixtures" → "17 fixtures"** (Architecture prose) — Sweep all references; the enumerated fixture list IS 17 (architecture's prose count was off-by-one).
2. **"6 Atenção / 8 Notável / 11 Rotina" → "7 / 8 / 11" base AD20 = 26 + 2 added in Epic 12 = 28 event_types total at end of MVP** (Architecture AD20 prose) — Sweep; the enumerated Atenção list IS 7; the seed adds `cycle-fail-sustained` (Story 12.1) + `platform-features-changed` (Story 12.3) bringing total to 28.
3. **Story 1.x Bob-trace collisions** in architecture's per-AD lines (e.g., AD3 says "Story 1.3 key-entry form" but §I sequence puts key entry in Epic 4) — Resolved per agreed Story 1.x layout (1.1 scaffold + /health, 1.2 envelope encryption, 1.3 pino, 1.4 signup + atomic profile, 1.5 founder admins); Winston updates the per-AD lines to match.
4. **Story 6.3 stale "verify via Mirakl MCP before locking" caveat** (Story 6.3 AC at line 1810 — now fixed) — APPLIED IN STEP 4 SWEEP (M1). PRI03 path locked: `GET /api/offers/pricing/imports/{importId}/error_report` returning CSV with `line_number` + `error_reason`.
5. **`sku_channels.pri01_consecutive_failures smallint NOT NULL DEFAULT 0`** (Story 6.3 introduces this column post-architecture) — Architecture schema needs update to include this column (I1).
6. **Story 6.3 frozen-state semantic-overload choice** (option a `frozen_reason` enum vs option b `frozen_for_pri01_persistent` boolean) — Bob picks during Story 6.3 sharding; architecture-doc updates the chosen pattern.
7. **Story 9.0 integration test count assertion** — Story 9.0 hardcodes "26"; Stories 12.1 + 12.3 bring it to 28. Refactor to assert `EVENT_TYPES.length` instead of hardcoded number — automatic with future event-type additions.
8. **`customers.day5_reminder_sent_at timestamptz` column** (Story 10.3 idempotency Pass 1 references the column) — APPLIED IN STEP 4 SWEEP (N1). Story 10.3 now lists `supabase/migrations/202604301216_add_day5_reminder_sent_at_to_customers.sql` migration.
9. **Story 1.5 `admin_access_denied` event logging — full email** (Pedro flagged GDPR PII minimization consideration) — Decide Phase 2 trigger: log hash of email (e.g., SHA-256 first 8 hex chars) instead of plaintext; or email-redaction list extension.
10. **Story 4.3 sign-off recording convention** (Pedro choice: PR comment vs `_bmad-output/sign-offs/story-4.3.md`) — Pedro picks once during first sign-off; documents convention going forward.
11. **UX-DR26 mobile bottom action bar safe-area inset (OQ-7)** — Story 8.12 AC notes Step 4 verification on iPhone SE / iPhone 14 simulators. Sally verifies in Pass 2 visual review; document any iOS Safari adjustments.
12. **pri02-complete event granularity (per-sku_channel)** — Story 6.2 emits one `pri02-complete` per affected sku_channel. Verify AD19's ~3M/quarter volume estimate accounts for this at 50k-SKU-per-import scale; if breaks NFR-P8, switch to one aggregate event per import.
13. **Story 9.6 `audit_log_atencao_archive` placement** — At MVP it's an in-DB single non-partitioned table; Bob picks at story sharding. Phase 2 trigger to evaluate S3-equivalent external archive when scale demands.
14. **Story 11.4 concierge marketplace-add CLI security** — Cleartext key handling reviewed against terminal masking + memory-only retention. Pre-customer-#2 security review of the CLI.
15. **Story 11.5 `moloni_invoices.customer_id` FK ON DELETE NO ACTION** (Story 11.5 schema) — Confirm fiscal-archive migration path before first deletion event hits a customer with prior invoices.
16. **Story 12.3 `critical-alert-platform-features-changed.eta`** (Story 12.3 needs a 9th template OR reuses generic) — Bob writes during Story 12.3 sharding; document the choice.
17. **Q1 — Cancel-mid-grace Stripe handling** (Story 10.2 AC) — DECIDED 2026-04-30 — keep current MVP-simple "re-enter from scratch" approach. Story 10.2 spec stays as-is. Bob adds a code comment in `app/src/routes/settings/cancel-deletion.js` documenting the Phase 2 refinement opportunity: *"Phase 2: if Stripe Subscription's current billing period has not yet ended at cancel-mid-grace time, uncancel via `cancel_at_period_end=false` instead of forcing customer to re-enter Stripe payment. Avoids the double-charge edge case for customers who cancel mid-grace early in their billing cycle. Trigger: any customer complaint about double-charge in months 1-2."*
18. **Q2 — `account-deletion-initiated` 29th event_type** (Pedro flagged) — DECIDED 2026-04-30 — NO 29th event_type. AD20 stays at 28 event_types at end of MVP (26 base seed from Story 9.0 + `cycle-fail-sustained` from Story 12.1 + `platform-features-changed` from Story 12.3). Rationale: email trail (deletion-confirmation + deletion-grace-reminder + deletion-final per Story 12.2) is the canonical record for account-lifecycle events; audit_log scope stays restricted to engine events. audit_log entries get wiped at T+7d hard-delete anyway, so logging the deletion-initiation event would be self-erasing. Story 10.1's transition `(<current> → PAUSED_BY_ACCOUNT_GRACE_PERIOD)` correctly emits NO audit event — matches the locked Note.
