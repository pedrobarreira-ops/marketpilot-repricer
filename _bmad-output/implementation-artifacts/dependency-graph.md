# Story Dependency Graph
_Last updated: 2026-05-13T12:00:00Z (Phase 0 pass 26 — Story 7.9 done via PR #93; Story 7.4 ready-for-dev; Ready cells recomputed)_

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
| 4.3 | 4 | Key entry form /onboarding/key + inline 5s validation + encrypted persistence [MERGE_BLOCK until 4.4 — CLEARED] | done | #15 | #73 | merged | 4.1, 1.2, 3.1 | ✅ Yes (done) |
| 4.4 | 4 | Async catalog scan orchestration A01 PC01 OF21 P11 tier-classify baseline (atomicity sibling 4.1) | done | #16 | #74 | merged | 4.1, 3.2, 4.2 | ✅ Yes (done) |
| 4.5 | 4 | Scan progress page /onboarding/scan — closeable + reconnectable + status polling | done | #17 | #77 | merged | 4.4 | ✅ Yes (done) |
| 4.6 | 4 | Scan-failed email + /scan-failed interception | done | #18 | #75 | merged | 4.4 | ✅ Yes (done) |
| 4.7 | 4 | Scan-ready interstitial /onboarding/scan-ready (UX-DR33-34) | done | #21 | #76 | merged | 4.4 | ✅ Yes (done) |
| 4.8 | 4 | Margin question /onboarding/margin + smart-default mapping + <5% warning | done | #63 | #78 | merged | 4.7 | ✅ Yes (done) |
| 4.9 | 4 | Dashboard root in DRY_RUN — minimal landing only | done | #20 | #79 | merged | 4.8 | ✅ Yes (done) |
| 5.1 | 5 | Master cron dispatcher + advisory locks + worker-must-filter-by-customer ESLint rule | done | #24 | #91 | merged | 4.1, 9.1 | ✅ Yes (done) |
| 5.2 | 5 | PRI01 staging schema + cycle assembly skeleton | done | #25 | #91 | merged | 5.1 | ✅ Yes (done) |
| 6.1 | 6 | shared/mirakl/pri01-writer.js + per-SKU aggregation + multipart submit + no-raw-CSV-building ESLint rule | done | #22 | #91 | merged | 5.2, 3.1 | ✅ Yes (done) |
| 6.2 | 6 | shared/mirakl/pri02-poller.js + worker/src/jobs/pri02-poll.js + cron entry complete/failed handling | done | #23 | #91 | merged | 6.1 | ✅ Yes (done) |
| 6.3 | 6 | shared/mirakl/pri03-parser.js + per-SKU rebuild semantics | done | #26 | #91 | merged | 6.2 | ✅ Yes (done) |
| 7.1 | 7 | shared/money/index.js + no-float-price ESLint rule (CALENDAR-EARLY) | done | #27 | #86 | merged | 1.1 (calendar-early: after_epic=1) | ✅ Yes (done) |
| 7.2 | 7 | worker/src/engine/decide.js — full AD8 decision flow with filter chain via self-filter | done | #28 | #91 | merged | 7.1, 3.2, 6.1 | ✅ Yes (done) |
| 7.3 | 7 | worker/src/engine/cooperative-absorb.js — STEP 2 absorption + skip-on-pending | done | #29 | #91 | merged | 7.2 | ✅ Yes (done) |
| 7.4 | 7 | worker/src/safety/anomaly-freeze.js + audit anomaly SKU accept/reject endpoints | ready-for-dev | #30 | — | — | 7.2, 9.0 | ✅ Yes |
| 7.5 | 7 | worker/src/engine/tier-classify.js — full transitions + atomic T2a→T2b write per F1 | backlog | #31 | — | — | 7.2 | ✅ Yes |
| 7.6 | 7 | worker/src/safety/circuit-breaker.js — per-SKU 15% + per-cycle 20% | done | #32 | #91 | merged | 7.2 | ✅ Yes (done) |
| 7.7 | 7 | worker/src/safety/reconciliation.js — Tier 3 daily pass = nightly reconciliation | backlog | #33 | — | — | 7.5 | ❌ No (7.5 not done) |
| 7.8 | 7 | END-TO-END INTEGRATION GATE — full cycle test on all 17 P11 fixtures (atomicity bundle gate AD7+AD8+AD9+AD11) | done | #34 | #91 | merged | 6.1, 7.2, 7.3, 7.6 | ✅ Yes (done) |
| 7.9 | 7 | Bundle-C cleanup chore — 9 test-tightening + spec-reconciliation follow-ups | done | #92 | #93 | merged | 7.8 (implicit: cleanup of Bundle C modules) | ✅ Yes (done) |
| 8.1 | 8 | Dashboard root state-aware view + sticky header chrome | backlog | #35 | — | — | 4.9, epic 7 complete | ❌ No (epic 7 not complete — 7.4, 7.5, 7.7 not done) |
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
- **4.3** depends on: 4.1, 1.2, 3.1 [MERGE_BLOCK: until 4.4 done — Bundle B — CLEARED: 4.4 done]
- **4.4** depends on: 4.1, 3.2, 4.2 (atomicity sibling of 4.1 — Bundle B)
- **4.5** depends on: 4.4
- **4.6** depends on: 4.4
- **4.7** depends on: 4.4
- **4.8** depends on: 4.7
- **4.9** depends on: 4.8
- **5.1** depends on: 4.1, 9.1 [MERGE_BLOCK: until 7.8 done — Bundle C — CLEARED: 7.8 done via PR #91]
- **5.2** depends on: 5.1 [MERGE_BLOCK: until 7.8 done — Bundle C — CLEARED]
- **6.1** depends on: 5.2, 3.1 [MERGE_BLOCK: until 7.8 done — Bundle C (AD7) — CLEARED]
- **6.2** depends on: 6.1 [MERGE_BLOCK: until 7.8 done — Bundle C — CLEARED]
- **6.3** depends on: 6.2 [MERGE_BLOCK: until 7.8 done — Bundle C — CLEARED]
- **7.1** depends on: 1.1 (calendar-early: after_epic=1 — calendar_early_overrides added 2026-05-10 sprint-planning amendment)
- **7.2** depends on: 7.1, 3.2, 6.1 [MERGE_BLOCK: until 7.8 done — Bundle C (AD8) — CLEARED]
- **7.3** depends on: 7.2 [MERGE_BLOCK: until 7.8 done — Bundle C (AD9) — CLEARED]
- **7.4** depends on: 7.2, 9.0
- **7.5** depends on: 7.2
- **7.6** depends on: 7.2 [MERGE_BLOCK: until 7.8 done — Bundle C (AD11) — CLEARED]
- **7.7** depends on: 7.5
- **7.8** depends on: 6.1, 7.2, 7.3, 7.6 (atomicity gate — all Bundle C participants — CLEARED via PR #91 mega-merge 2026-05-11)
- **7.9** depends on: 7.8 (implicit: Bundle C cleanup chore sharded from retro Q7 — dispatches normally from main)
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

### Current State (Phase 0 pass 26 — 2026-05-13 Story 7.9 done)

- **BUNDLE C COMPLETE**: PR #91 (Bundle C atomicity gate — Story 7.8 + all 8 participants) merged 2026-05-11T20:06:22Z. This mega-merge (squash commit 89b2378) supersedes individual PRs #81-#89 (all CLOSED). All 8 Bundle C participants (5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.6) + gate 7.8 are `done`. 45/45 integration tests passed against real Bundle C modules.
- **Story 7.9 DONE**: PR #93 (story-7.9-bundle-c-cleanup-chore) merged 2026-05-13T11:26:42Z. 9 follow-ups: narrowed-catch retroactive, AC8 5-module presence, staging INSERT circularity, N>1 batch atomicity, AC3/AC4 reconciliation, unit-test _expected oracle migration, decide.js regression, 3-strike re-fire test. Closed 5 Bundle-C-introduced unit-test fails.
- Epic 1 complete (5/5 stories done — pre-BAD direct commits to main, no PRs). Epic 1 retrospective complete (2026-05-03).
- Epic 2 complete (2/2 stories done). Epic 2 retrospective complete (2026-05-04).
- Calendar-early: Story 9.0 merged (PR #66). Story 9.1 merged (PR #67). epic-9: in-progress (9.0 + 9.1 done; 9.2-9.6 backlog).
- Epic 3 complete (3/3 stories done). Epic 3 retrospective complete (2026-05-06). Live smoke ✅.
- Epic 4 complete (9/9 stories done). Epic 4 retrospective complete (2026-05-08). Atomicity Bundle B held and cleared.
- **Epic 5 COMPLETE** (2/2 stories done via PR #91 mega-merge). Epic 5 retrospective done (Bundle C close-out retro 2026-05-13).
- **Epic 6 COMPLETE** (3/3 stories done via PR #91 mega-merge). Epic 6 retrospective done (Bundle C close-out retro 2026-05-13).
- Epic 7: in-progress. 7.1 + 7.2 + 7.3 + 7.6 + 7.8 + 7.9 done. **7.4 READY** (ready-for-dev, deps 7.2+9.0 done; epics 1-6 complete). **7.5 READY** (backlog, dep 7.2 done; epics 1-6 complete). 7.7 blocked on 7.5.
- No active worktrees (all Bundle C worktrees cleaned up; Story 7.9 worktree cleaned per post-merge).

### Ready-to-Work Analysis (Pass 26)

**Ready to dispatch:**
- **7.4** — status: ready-for-dev (story file exists). Deps 7.2 (done/PR#91 merged) + 9.0 (done/PR#66 merged). Epics 1-6 all done. Not in merge_blocks, not in calendar_early_overrides. ✅ Yes.
- **7.5** — status: backlog (needs sharding). Dep 7.2 (done/PR#91 merged). Epics 1-6 all done. Not in merge_blocks, not in calendar_early_overrides. ✅ Yes.

**Done this pass:**
- **7.9** — PR #93 merged 2026-05-13T11:26:42Z. ✅ Yes (done).

**Still blocked:**
- **7.7** — dep 7.5 (backlog, not done). ❌ No (7.5 not done).
- **8.x** — all require epic 7 complete (7.4, 7.5, 7.7 not done). ❌ No (epic 7 not complete).
- **9.2-9.6** — require epic 8 complete. ❌ No.
- **10.x, 11.x, 12.x** — blocked further downstream.

### Parallelization Opportunities

- **Immediate batch (2 stories):** 7.4 (ready-for-dev) and 7.5 (backlog → needs sharding) are both Ready to Work from `main`. These can dispatch in parallel.
  - 7.4 already has a story file — can dispatch immediately.
  - 7.5 needs Bob to shard first (bmad-create-story).
- Once 7.4 and 7.5 are done, 7.7 becomes Ready (dep: 7.5 done). Then Epic 7 closes, unblocking all of Epic 8 (12 stories with significant parallelism — 8.3-8.12 can mostly run in parallel after 8.1 ships).

### Merge Blocks (atomicity constraints)

- **Bundle B** (Story 4.3): CLEARED — Story 4.4 is done.
- **Bundle C** (Stories 5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.6, 7.8): CLEARED — Story 7.8 gate passed via PR #91 mega-merge 2026-05-11. All participants are `done`. merge_blocks entries are historic only.

### Integration Test Gate (Phase 4.5)

- Stories 2.1, 2.2, 9.1, 4.1, and 4.6 have `integration_test_required: true` — all passed.
- Story 7.9 cleanup chore: likely no integration_test_required (no new external library surfaces — it's refactoring/test tightening).
- Story 7.4 (anomaly-freeze + endpoints) and 7.5 (tier-classify) may require `integration_test_required: true` — Bob will assess during sharding.
