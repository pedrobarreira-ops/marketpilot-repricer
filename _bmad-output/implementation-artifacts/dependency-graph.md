# Story Dependency Graph
_Last updated: 2026-05-08T00:00:00Z_

## Stories

| Story | Epic | Title | Sprint Status | Issue | PR | PR Status | Dependencies | Ready to Work |
|-------|------|-------|--------------|-------|----|-----------|--------------|---------------|
| 1.1 | 1 | Scaffold project, two-service Coolify deploy, composed /health | done | #1 | — | — (pre-BAD direct commit) | none | ✅ Yes (done) |
| 1.2 | 1 | Envelope encryption module, master-key loader, secret-scanning hook | done | #2 | — | — (pre-BAD direct commit) | 1.1 | ✅ Yes (done) |
| 1.3 | 1 | Pino structured logging with redaction list | done | #3 | — | — (pre-BAD direct commit) | 1.1 | ✅ Yes (done) |
| 1.4 | 1 | Signup endpoint, atomic profile trigger, source-context capture | done | #4 | — | — (pre-BAD direct commit) | 1.1, 1.3 | ✅ Yes (done) |
| 1.5 | 1 | Founder admins seed + admin-auth middleware | done | #5 | — | — (pre-BAD direct commit) | 1.4 | ✅ Yes (done) |
| 2.1 | 2 | RLS-aware app DB client + service-role worker DB client + transaction helper | done | #6 | #64 | merged | 1.4 | ✅ Yes (done) |
| 2.2 | 2 | RLS regression suite + CI block | done | #7 | #65 | merged | 1.4, 1.2, 2.1 | ✅ Yes (done) |
| 9.0 | 9 | writeAuditEvent SSoT module + audit_log_event_types lookup table (CALENDAR-EARLY) | done | #8 | #66 | merged | 1.1, 1.3, 2.1; after_epic: 2 | ✅ Yes (done) |
| 9.1 | 9 | Audit log partitioned base table + priority-derivation trigger + monthly partition cron (CALENDAR-EARLY) | done | #9 | #67 | merged | 9.0, 2.1; after_epic: 2 | ✅ Yes (done) |
| 3.1 | 3 | Mirakl HTTP client port — apiClient + retry/backoff + safe-error mapping + no-direct-fetch ESLint rule | done | #10 | #68 | merged | 1.1, 1.3; epic 2 complete | ✅ Yes (done) |
| 3.2 | 3 | Endpoint wrappers A01, PC01, OF21, P11 + Mirakl mock server | done | #11 | #69 | merged | 3.1, 2.1 | ✅ Yes (done) |
| 3.3 | 3 | Mirakl empirical verify smoke-test script | done | #12 | #70 | merged | 3.1, 3.2 | ✅ Yes (done) |
| 4.1 | 4 | customer_marketplaces schema + F4 PROVISIONING + cron state machine transitions matrix | done | #13 | #71 | merged | 2.1, 9.0, 9.1 | ✅ Yes (done) |
| 4.2 | 4 | skus, sku_channels, baseline_snapshots, scan_jobs schemas + RLS | done | #14 | #72 | merged | 4.1 | ✅ Yes (done) |
| 4.3 | 4 | Key entry form /onboarding/key + inline 5s validation + encrypted persistence [MERGE_BLOCK until 4.4] | done | #15 | #73 | merged | 4.1, 1.2, 3.1 | ✅ Yes (done) |
| 4.4 | 4 | Async catalog scan orchestration A01 PC01 OF21 P11 tier-classify baseline (atomicity sibling 4.1) | done | #16 | #74 | merged | 4.1, 3.2, 4.2 | ✅ Yes (done) |
| 4.5 | 4 | Scan progress page /onboarding/scan — closeable + reconnectable + status polling | done | #17 | #77 | merged | 4.4 | ✅ Yes (done) |
| 4.6 | 4 | Scan-failed email + /scan-failed interception | done | #18 | #75 | merged | 4.4 | ✅ Yes (done) |
| 4.7 | 4 | Scan-ready interstitial /onboarding/scan-ready (UX-DR33-34) | done | #21 | #76 | merged | 4.4 | ✅ Yes (done) |
| 4.8 | 4 | Margin question /onboarding/margin + smart-default mapping + <5% warning | done | #63 | #78 | merged | 4.7 | ✅ Yes (done) |
| 4.9 | 4 | Dashboard root in DRY_RUN — minimal landing only | done | #20 | #79 | merged | 4.8 | ✅ Yes (done) |
| 5.1 | 5 | Master cron dispatcher + advisory locks + worker-must-filter-by-customer ESLint rule [MERGE_BLOCK until 7.8] | backlog | #24 | — | — | 4.1, 9.1 | ✅ Yes |
| 5.2 | 5 | PRI01 staging schema + cycle assembly skeleton [MERGE_BLOCK until 7.8] | backlog | #25 | — | — | 5.1 | ❌ No (5.1 not done) |
| 6.1 | 6 | shared/mirakl/pri01-writer.js + per-SKU aggregation + multipart submit + no-raw-CSV-building ESLint rule [MERGE_BLOCK until 7.8] | backlog | #22 | — | — | 5.2, 3.1 | ❌ No (epic 5 not complete) |
| 6.2 | 6 | shared/mirakl/pri02-poller.js + worker/src/jobs/pri02-poll.js + cron entry complete/failed handling [MERGE_BLOCK until 7.8] | backlog | #23 | — | — | 6.1 | ❌ No (epic 5 not complete) |
| 6.3 | 6 | shared/mirakl/pri03-parser.js + per-SKU rebuild semantics [MERGE_BLOCK until 7.8] | backlog | #26 | — | — | 6.2 | ❌ No (epic 5 not complete) |
| 7.1 | 7 | shared/money/index.js + no-float-price ESLint rule | backlog | #27 | — | — | epic 6 complete | ❌ No (epic 6 not complete) |
| 7.2 | 7 | worker/src/engine/decide.js — full AD8 decision flow with filter chain via self-filter [MERGE_BLOCK until 7.8] | backlog | #28 | — | — | 7.1, 3.2, 6.1 | ❌ No (epic 6 not complete) |
| 7.3 | 7 | worker/src/engine/cooperative-absorb.js — STEP 2 absorption + skip-on-pending [MERGE_BLOCK until 7.8] | backlog | #29 | — | — | 7.2 | ❌ No (epic 6 not complete) |
| 7.4 | 7 | worker/src/safety/anomaly-freeze.js + audit anomaly SKU accept/reject endpoints | backlog | #30 | — | — | 7.2, 9.0 | ❌ No (epic 6 not complete) |
| 7.5 | 7 | worker/src/engine/tier-classify.js — full transitions + atomic T2a→T2b write per F1 | backlog | #31 | — | — | 7.2 | ❌ No (epic 6 not complete) |
| 7.6 | 7 | worker/src/safety/circuit-breaker.js — per-SKU 15% + per-cycle 20% [MERGE_BLOCK until 7.8] | backlog | #32 | — | — | 7.2 | ❌ No (epic 6 not complete) |
| 7.7 | 7 | worker/src/safety/reconciliation.js — Tier 3 daily pass = nightly reconciliation | backlog | #33 | — | — | 7.5 | ❌ No (epic 6 not complete) |
| 7.8 | 7 | END-TO-END INTEGRATION GATE — full cycle test on all 17 P11 fixtures (atomicity bundle gate AD7+AD8+AD9+AD11) | backlog | #34 | — | — | 6.1, 7.2, 7.3, 7.6 | ❌ No (epic 6 not complete) |
| 8.1 | 8 | Dashboard root state-aware view + sticky header chrome | backlog | #35 | — | — | 4.9, epic 7 complete | ❌ No (epic 7 not complete) |
| 8.2 | 8 | KPI cards row (3 status cards + secondary catalog-value lines) | backlog | #36 | — | — | 8.1, 9.2 | ❌ No (epic 7 not complete) |
| 8.3 | 8 | PT/ES channel toggle pill in sticky header | backlog | #37 | — | — | 8.1 | ❌ No (epic 7 not complete) |
| 8.4 | 8 | Margin editor inline panel with worked-profit-example | backlog | #38 | — | — | 8.1 | ❌ No (epic 7 not complete) |
| 8.5 | 8 | Pause/Resume buttons + customer-pause cron_state transitions | backlog | #39 | — | — | 8.1, 4.1 | ❌ No (epic 7 not complete) |
| 8.6 | 8 | Go-Live consent modal + Stripe redirect | backlog | #40 | — | — | 8.1, 11.1 | ❌ No (epic 7 not complete) |
| 8.7 | 8 | Anomaly review modal (consumes Story 7.4 endpoints) | backlog | #41 | — | — | 8.1, 7.4 | ❌ No (epic 7 not complete) |
| 8.8 | 8 | Banner library + UX4 stack precedence | backlog | #42 | — | — | 8.1 | ❌ No (epic 7 not complete) |
| 8.9 | 8 | Interception pages — /key-revoked + /payment-failed | backlog | #43 | — | — | 8.1 | ❌ No (epic 7 not complete) |
| 8.10 | 8 | /admin/status founder page (reuses customer audit-log UI) | backlog | #44 | — | — | 8.1, 1.5, 9.3 | ❌ No (epic 7 not complete) |
| 8.11 | 8 | Settings sectioned navigation (5 pages) | backlog | #45 | — | — | 8.1 | ❌ No (epic 7 not complete) |
| 8.12 | 8 | Mobile-focused critical-alert response surface | backlog | #46 | — | — | 8.1 | ❌ No (epic 7 not complete) |
| 9.2 | 9 | daily_kpi_snapshots + cycle_summaries schemas + daily-aggregate cron + 5-min today partial refresh | backlog | #47 | — | — | 9.1, 7.8 | ❌ No (epic 8 not complete) |
| 9.3 | 9 | 5-surface query endpoints — audit root + daily summary + Atenção feed + Notável feed | backlog | #48 | — | — | 9.2 | ❌ No (epic 8 not complete) |
| 9.4 | 9 | Search by SKU/EAN endpoint — primary investigation primitive | backlog | #49 | — | — | 9.3 | ❌ No (epic 8 not complete) |
| 9.5 | 9 | Firehose /audit/firehose — cycle-aggregated view with lazy-loaded SKU expansion | backlog | #50 | — | — | 9.3 | ❌ No (epic 8 not complete) |
| 9.6 | 9 | Audit-log archive job — detach old partitions per AD19 retention semantics | backlog | #51 | — | — | 9.1 | ❌ No (epic 8 not complete) |
| 10.1 | 10 | /settings/delete multi-step initiation + ELIMINAR phrase + key destruction + Stripe cancel_at_period_end | backlog | #52 | — | — | 8.11, 9.0, 1.2 | ❌ No (epic 9 not complete) |
| 10.2 | 10 | Cancel-mid-grace flow (magic link in email + dashboard Cancelar eliminação banner button) | backlog | #53 | — | — | 10.1 | ❌ No (epic 9 not complete) |
| 10.3 | 10 | Daily deletion-grace cron (day-5 reminder email + T+7d hard-delete + audit-log archive coordination) | backlog | #54 | — | — | 10.1, 9.6 | ❌ No (epic 9 not complete) |
| 11.1 | 11 | Stripe Customer + Subscription + first SubscriptionItem creation on Go-Live | backlog | #55 | — | — | 4.1, 8.6 | ❌ No (epic 10 not complete) |
| 11.2 | 11 | Stripe webhook — signature + replay protection + idempotency + cron_state transitions | backlog | #56 | — | — | 11.1 | ❌ No (epic 10 not complete) |
| 11.3 | 11 | /settings/billing page + Stripe Customer Portal link | backlog | #57 | — | — | 8.11, 11.1 | ❌ No (epic 10 not complete) |
| 11.4 | 11 | Concierge marketplace-add admin script (founder CLI for adding 2nd+ marketplace) | backlog | #58 | — | — | 4.1, 11.1 | ❌ No (epic 10 not complete) |
| 11.5 | 11 | moloni_invoices table + NIF capture flow at Day-3 pulse-check + admin record route | backlog | #59 | — | — | 11.2 | ❌ No (epic 10 not complete) |
| 12.1 | 12 | 3-tier failure model finalization + sustained-transient classifier + cycle-fail-sustained event_type | backlog | #60 | — | — | 9.0, 7.8 | ❌ No (epic 11 not complete) |
| 12.2 | 12 | shared/resend/client.js extension + PT-localized template helpers + 8 critical-alert templates | backlog | #61 | — | — | 4.6, 12.1 | ❌ No (epic 11 not complete) |
| 12.3 | 12 | PC01 monthly re-pull cron + platform-features-changed event_type addition | backlog | #62 | — | — | 5.1, 9.0 | ❌ No (epic 11 not complete) |

## Dependency Chains

- **2.2** depends on: 2.1, 1.4, 1.2
- **9.0** depends on: 1.1, 1.3, 2.1 (calendar-early: after_epic=2)
- **9.1** depends on: 9.0, 2.1 (calendar-early: after_epic=2)
- **3.1** depends on: 1.1, 1.3 (epic-ordering: epic 2 must be complete)
- **3.2** depends on: 3.1, 2.1
- **3.3** depends on: 3.1, 3.2
- **4.1** depends on: 2.1, 9.0, 9.1 (epic-ordering: epic 3 must be complete)
- **4.2** depends on: 4.1
- **4.3** depends on: 4.1, 1.2, 3.1 [MERGE_BLOCK: until 4.4 done — Bundle B]
- **4.4** depends on: 4.1, 3.2, 4.2 (atomicity sibling of 4.1 — Bundle B; 4.3 removed: vault schema ships with 4.1, not 4.3)
- **4.5** depends on: 4.4
- **4.6** depends on: 4.4
- **4.7** depends on: 4.4
- **4.8** depends on: 4.7
- **4.9** depends on: 4.8
- **5.1** depends on: 4.1, 9.1 [MERGE_BLOCK: until 7.8 done — Bundle C]
- **5.2** depends on: 5.1 [MERGE_BLOCK: until 7.8 done — Bundle C]
- **6.1** depends on: 5.2, 3.1 [MERGE_BLOCK: until 7.8 done — Bundle C (AD7)]
- **6.2** depends on: 6.1 [MERGE_BLOCK: until 7.8 done — Bundle C]
- **6.3** depends on: 6.2 [MERGE_BLOCK: until 7.8 done — Bundle C]
- **7.1** depends on: epic 6 complete
- **7.2** depends on: 7.1, 3.2, 6.1 [MERGE_BLOCK: until 7.8 done — Bundle C (AD8)]
- **7.3** depends on: 7.2 [MERGE_BLOCK: until 7.8 done — Bundle C (AD9)]
- **7.4** depends on: 7.2, 9.0
- **7.5** depends on: 7.2
- **7.6** depends on: 7.2 [MERGE_BLOCK: until 7.8 done — Bundle C (AD11)]
- **7.7** depends on: 7.5
- **7.8** depends on: 6.1, 7.2, 7.3, 7.6 (atomicity gate — fires only after all Bundle C participants land)
- **8.1** depends on: 4.9, epic 7 complete
- **8.2** depends on: 8.1, 9.2
- **8.3** depends on: 8.1
- **8.4** depends on: 8.1
- **8.5** depends on: 8.1, 4.1
- **8.6** depends on: 8.1, 11.1
- **8.7** depends on: 8.1, 7.4
- **8.8** depends on: 8.1
- **8.9** depends on: 8.1
- **8.10** depends on: 8.1, 1.5, 9.3
- **8.11** depends on: 8.1
- **8.12** depends on: 8.1
- **9.2** depends on: 9.1, 7.8 (epic-ordering: epic 8 must be complete)
- **9.3** depends on: 9.2
- **9.4** depends on: 9.3
- **9.5** depends on: 9.3
- **9.6** depends on: 9.1
- **10.1** depends on: 8.11, 9.0, 1.2
- **10.2** depends on: 10.1
- **10.3** depends on: 10.1, 9.6
- **11.1** depends on: 4.1, 8.6
- **11.2** depends on: 11.1
- **11.3** depends on: 8.11, 11.1
- **11.4** depends on: 4.1, 11.1
- **11.5** depends on: 11.2
- **12.1** depends on: 9.0, 7.8
- **12.2** depends on: 4.6, 12.1
- **12.3** depends on: 5.1, 9.0

## Notes

### Current State (Phase 0 reconciliation 2026-05-08 pass 7)
- Epic 1 complete (5/5 stories done — pre-BAD direct commits to main, no PRs).
- Epic 1 retrospective complete (2026-05-03).
- Epic 2 complete (2/2 stories done).
  - Story 2.1 merged (PR #64, 2026-05-03). sprint-status: done.
  - Story 2.2 merged (PR #65, 2026-05-04). sprint-status: done.
- Epic 2 retrospective complete (2026-05-04).
- Calendar-early: Story 9.0 merged (PR #66, 2026-05-04). sprint-status: done.
- Calendar-early: Story 9.1 merged (PR #67, 2026-05-06). sprint-status: done.
  - epic-9 row: in-progress (9.0 + 9.1 done; 9.2-9.6 still backlog).
- Calendar-early block complete (9.0 + 9.1 both done). 12 Batch-2 dependents unblocked from the calendar-early gate.
- Story 3.1 merged (PR #68, 2026-05-06). sprint-status: done.
- Story 3.2 merged (PR #69, 2026-05-06). sprint-status: done.
- Story 3.3 merged (PR #70, 2026-05-06). sprint-status: done. Epic 3 complete (3/3 done).
- Epic 3 complete. Epic 3 retrospective complete (2026-05-06). Live smoke passed ✅ (A01/PC01/OF21/P11).
- Story 4.1 merged (PR #71, 2026-05-06). sprint-status: done. ATOMICITY BUNDLE B (1/2) shipped.
- Story 4.2 merged (PR #72, 2026-05-06). sprint-status: done.
- Story 4.4 merged (PR #74, 2026-05-07T10:03:17Z). sprint-status: done. ATOMICITY BUNDLE B (2/2) shipped.
- Story 4.3 merged (PR #73, 2026-05-07T11:29:54Z). sprint-status: done. Bundle B MERGE_BLOCK cleared.
- Story 4.5 merged (PR #77, 2026-05-07T14:51:11Z). sprint-status: done.
- Story 4.6 merged (PR #75, 2026-05-07T15:24:25Z). sprint-status: done.
- Story 4.7 merged (PR #76, 2026-05-07T15:52:41Z). sprint-status: done.
- Story 4.8 merged (PR #78, 2026-05-07T17:30:15Z). sprint-status: done.
- Story 4.9 merged (PR #79, 2026-05-07T19:44:06Z). sprint-status: done. **Epic 4 COMPLETE (9/9 stories done).**
- epic-4 row: flipped in-progress → done (Phase 0 epic-row reconciliation 2026-05-08).
- Open PR: #80 (epic-4-retro-p0-fixes) — retro P0 fixes branch, not a story PR.
- Current Ready to Work: **5.1** — Epic 4 complete, unlocking Epic 5.
  - 5.1: Ready (depends on 4.1 + 9.1 — both done; epics 1-4 all complete). Status: backlog.
  - 5.2+: Blocked on 5.1 not yet done.

### Parallelization Opportunities
- **Current batch (Epic 5 start):** Story **5.1** is the only ready story — first story in Epic 5. Sharding needed.
- Epic 5 is sequential (5.1 → 5.2). No parallelism within Epic 5.
- Bundle C (Epics 5-7): Stories 5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.6 can be developed in parallel but ALL must hold for merge until 7.8 gate passes.
- Epic 8 has the most parallelism: stories 8.3-8.12 can mostly run in parallel after 8.1 ships.

### Merge Blocks (atomicity constraints)
- **Bundle B**: Story 4.3 PR must not merge until Story 4.4 is done (CHECK constraint in PROVISIONING state machine; 4.3 creates rows, 4.4 completes the path forward).
- **Bundle C**: Stories 5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.6 PRs must not merge until Story 7.8 integration gate passes. Engine + writer + cooperative-absorption + circuit-breaker must be validated together against all 17 P11 fixtures before any participant ships to main.

### Integration Test Gate (Phase 4.5)
- Stories 2.1, 2.2, 9.1, and 4.1 have `integration_test_required: true` — Pedro must run `npm run test:integration` locally after each of these stories completes and report pass/fail before BAD continues.
- Story 4.1's gate is the next integration-test obligation (schema + F4 CHECK constraint + RLS isolation + transitionCronState audit emission).
