# Sprint Change Proposal — 2026-05-15

**Triggered by:** Pedro ran `/bad 8.2` through the orchestrator; BAD Phase 0 surfaced a circular dependency that blocked Story 8.2 indefinitely.

**Author:** Bob (Scrum Master) via `bmad-correct-course`.

**Scope classification:** Minor — process correction at the sprint-status / dependency-graph layer. No story spec content amendments. No code, schema, or migration changes.

---

## Section 1 — Issue Summary

**Symptom.** When `/bad 8.2` ran in Phase 0 today, the orchestrator reported Story 8.2 as unrunnable due to a circular block:

```
Story 8.2 (KPI cards) → depends on → Story 9.2 (daily_kpi_snapshots)
Story 9.2 → "epic-ordering: epic 8 must be complete" → Epic 8 includes 8.2 → loop
```

BAD recommended a workaround (skip 8.2, pick next-ready 8.3+, re-run without filter). Pedro declined — the workaround leaves the spec rot in place; next attempt at 8.2 would hit the same wall.

**Context of discovery.** Story 8.1 merged 2026-05-14 (PR #98), Epic 8 entered "in-progress" status, 8.2 was the next ordering pick. The deadlock had been latent since sprint planning; only became visible when the dispatcher attempted to dispatch 8.2.

**Evidence.** From `_bmad-output/implementation-artifacts/dependency-graph.md` (Phase 0 pass 30, 2026-05-15):

> `| 8.2 | 8 | KPI cards row ... | backlog | #36 | — | — | 8.1, 9.2 | ❌ No (9.2 not done) |`
> `| 9.2 | 9 | daily_kpi_snapshots + cycle_summaries ... | backlog | #47 | — | — | 9.1, 7.8 | ❌ No (epic 8 not complete) |`

---

## Section 2 — Impact Analysis

### Root cause

The `(epic-ordering: epic 8 must be complete)` annotation on Story 9.2's dependency-graph row is a **heuristic over-block**, not a spec-level dependency. Tracing the actual spec:

| Source | What it declares |
|---|---|
| `epics-distillate/06-epics-9-10-audit-deletion.md` body of 9.2 | "Depends on Story 9.0 + 9.1 (audit_log foundation), Story 5.2 (cycle-end hook), Story 4.1 (customer_marketplace), Story 4.2 (sku_channels)" — **no mention of Epic 8** |
| Sprint-status.yaml `calendar_early_overrides:` precedents | 9.0 + 9.1 (`after_epic: 2`), 7.1 (`after_epic: 1`) — established mechanism for exactly this pattern |
| Story 9.2's actual deps | 9.0 ✅, 9.1 ✅, 5.2 ✅ (via PR #91), 4.1 ✅, 4.2 ✅ — **all done** |

The dependency-graph's epic-ordering filter ("Epic 9 stories require all of Epic 8 done") uniformly stamps `epic-ordering: epic 8 must be complete` onto **every** Epic 9 row whose Epic 8 isn't fully complete — regardless of whether the spec actually requires it. Story 7.1's calendar-early override (added 2026-05-10) is the exact precedent for resolving this: pure utility/foundation work that has no actual code dep on the in-flight epic.

### Established mechanism

`sprint-status.yaml` already codifies the fix path via the `calendar_early_overrides:` block (lines 285-294):

```yaml
calendar_early_overrides:
  9-0-...:
    after_epic: 2
    test_design_epic: 9
  9-1-...:
    after_epic: 2
    test_design_epic: 9
  7-1-shared-money-...:
    after_epic: 1   # ... Calendar-early treatment matches the 9.0/9.1 precedent — pure utility module, no actual code dep on Epic 5/6
    test_design_epic: 7
```

Phase 0's "Ready to Work" rule reads `after_epic` and exempts the story from the default lowest-incomplete-epic filter. Phase 1's Epic-Start trigger reads `test_design_epic` (Epic 9's test design is already `done`, so 9.2/9.3 will skip Epic-Start naturally).

### Story-level impact

| Story | Current state | After fix |
|---|---|---|
| **8.2** KPI cards | ❌ Blocked on 9.2 (which is itself falsely blocked) | ❌ Still blocked on 9.2 — but 9.2 is now Ready and dispatchable, so 8.2 unblocks naturally on next pass once 9.2 ships |
| **9.2** daily_kpi_snapshots | ❌ Blocked on phantom "epic 8 must be complete" | ✅ Ready (deps 9.0, 9.1, 5.2, 4.1, 4.2 all done) |
| **9.3** 5-surface audit query endpoints | ❌ Blocked on phantom "epic 8 must be complete" | ❌ Still blocked on 9.2 not done — but no longer false-blocked at epic level |
| **8.10** /admin/status | ❌ Blocked on 9.3 (which is itself falsely blocked) | ❌ Still blocked on 9.3 — unblocks once 9.3 ships |
| **8.7** anomaly modal | ✅ Ready (depends on 8.1 + 7.4, both done) — but its "Ver histórico" link target (9.3 audit feed) won't render usefully until 9.3 ships | Same as today; not impacted |
| **9.4** search-by-SKU | ❌ Blocked on phantom "epic 8 must be complete" | ❌ Still blocked on 9.3 not done — accurate spec-level block |
| **9.5** firehose | Same as 9.4 | Same as 9.4 |
| **9.6** archive job | ❌ Currently labelled "epic 8 not complete" | ❌ Real blocker is Story 10.1 (which is blocked on 8.11). Note corrected for accuracy; no calendar-early addition. |

### Artifact impact

| Artifact | Change |
|---|---|
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Add 2 entries to `calendar_early_overrides:` block |
| `_bmad-output/implementation-artifacts/dependency-graph.md` | Update rows for 9.2, 9.3, 9.4, 9.5, 9.6; update Notes + Parallelization sections; update timestamp |
| `_bmad-output/planning-artifacts/epics-distillate/06-epics-9-10-audit-deletion.md` | Add `[CALENDAR-EARLY — Story 8.x sibling]` markers + `Notes:` lines to 9.2 and 9.3 headers (matches 9.0/9.1 pattern) |
| `_bmad-output/planning-artifacts/epics-distillate/_index.md` | Update line 40 marker manifest + line 330 exception note |
| `project-context.md` | Append calendar-early note for 7.1 + 9.2 + 9.3 (project-level denormalized lookup; 7.1 was already lagging) |

### Technical impact

- **No code changes.** No story is mid-implementation in this dep chain.
- **No migration drift.** 9.2's migrations (`202604301209_create_daily_kpi_snapshots.sql`, `202604301210_create_cycle_summaries.sql`) are next-in-sequence per migration ordering; their timestamps already account for calendar-early shipping.
- **No spec content amendments.** 9.2 and 9.3 acceptance criteria stand verbatim. Story 8.2 AC3's "Atualização em curso" graceful-degradation caption stays as the steady-state edge-case microcopy it was designed to be.
- **Orchestrator alignment.** On next `/bad` run, Phase 0 reads updated sprint-status.yaml → recomputes Ready cells → dispatches 9.2 (or another ready story per the dispatcher heuristic).

---

## Section 3 — Recommended Approach

**Direct adjustment** — extend the already-codified `calendar_early_overrides` mechanism to cover 9.2 and 9.3. Smallest possible diff that resolves the deadlock and aligns with the architectural precedent already established (Story 7.1 calendar-early via the same mechanism, 2026-05-10).

**Rationale:**

1. **Spec content is correct.** Story 9.2's body never claimed to need Epic 8 surfaces. The deadlock is in derived artifacts (dependency graph) and the absence of an override that should have been there.
2. **Mechanism is proven.** The `calendar_early_overrides` block is the standing solution for "Epic N+ foundation story whose actual deps are all in Epic <N done early"; it's already battle-tested by 9.0, 9.1, 7.1.
3. **Option A (placeholder KPI data + follow-up wire-up) was explicitly declined** — and would ship 8.2 in a state that looks broken to the customer until a second story rewires it.
4. **Effort:** ~5 file edits, ~20 lines of YAML/markdown, single commit. No subagent dispatch needed.
5. **Risk:** None at the spec/sprint level. Orchestrator's Phase 0 regenerates `dependency-graph.md` from `sprint-status.yaml` on next run; manual graph edits here are pre-emptive documentation that will be reconciled.

**Timeline impact:** Net positive. Unblocks 9.2 (and once 9.2 ships, 8.2 + 9.3 + 8.10 unblock in sequence). Removes the latent risk that further Epic 9 stories repeat this heuristic over-block.

---

## Section 4 — Detailed Change Proposals

### Change 1 — `_bmad-output/implementation-artifacts/sprint-status.yaml`

**Location:** `calendar_early_overrides:` block, after the `7-1-...` entry (line ~294)

**OLD** (lines 285-294):
```yaml
calendar_early_overrides:
  9-0-writeauditevent-ssot-module-audit-log-event-types-lookup-table-26-row-ad20-taxonomy-seed:
    after_epic: 2
    test_design_epic: 9
  9-1-audit-log-partitioned-base-table-priority-derivation-trigger-initial-partition-monthly-partition-cron:
    after_epic: 2
    test_design_epic: 9
  7-1-shared-money-index-js-no-float-price-eslint-rule:
    after_epic: 1   # 04-epic-7-engine-safety.md:38 — "Depends on Story 1.1 (eslint config)" — only Epic 1's eslint config required ... [unchanged]
    test_design_epic: 7
```

**NEW** (adds 2 entries):
```yaml
calendar_early_overrides:
  9-0-writeauditevent-ssot-module-audit-log-event-types-lookup-table-26-row-ad20-taxonomy-seed:
    after_epic: 2
    test_design_epic: 9
  9-1-audit-log-partitioned-base-table-priority-derivation-trigger-initial-partition-monthly-partition-cron:
    after_epic: 2
    test_design_epic: 9
  7-1-shared-money-index-js-no-float-price-eslint-rule:
    after_epic: 1   # 04-epic-7-engine-safety.md:38 — "Depends on Story 1.1 (eslint config)" — only Epic 1's eslint config required ... [unchanged]
    test_design_epic: 7
  9-2-daily-kpi-snapshots-cycle-summaries-schemas-daily-aggregate-cron-5-min-today-partial-refresh:
    after_epic: 7   # 06-epics-9-10-audit-deletion.md:80 — spec deps (9.0, 9.1, 5.2, 4.1, 4.2) all done; no actual code dep on Epic 8 surfaces. Dependency-graph's "epic-ordering: epic 8 must be complete" was a heuristic over-block, not a spec dep. Calendar-early treatment matches 9.0/9.1/7.1 precedent — pure foundation work (2 migrations + worker cron + cycle-end hook into Story 5.2). Resolves 8.2↔9.2 deadlock surfaced by /bad 8.2 (SCP-2026-05-15).
    test_design_epic: 9
  9-3-5-surface-query-endpoints-audit-root-with-daily-summary-atencao-feed-notavel-feed:
    after_epic: 7   # 06-epics-9-10-audit-deletion.md:92 — spec deps (8.1, 9.0, 9.1, 9.2) — 8.1 done, foundation done, 9.2 now calendar-early. No actual code dep on other Epic 8 surfaces. Unblocks Story 8.10 (admin /status reuses 9.3's audit-log UI via ?as_admin=) and lets Story 8.7's "Ver histórico" link target render natively. SCP-2026-05-15.
    test_design_epic: 9
```

**Rationale:** Codifies the override at the authoritative source. Phase 0's `after_epic` filter exempts 9.2 + 9.3 from the lowest-incomplete-epic block. Epic 9's `epic_test_design` flag is already `done`, so Phase 1 skips Epic-Start for them naturally (per the existing comment at sprint-status.yaml lines 250-251).

---

### Change 2 — `_bmad-output/implementation-artifacts/dependency-graph.md`

#### 2a. Header timestamp

**OLD** (line 2):
```
_Last updated: 2026-05-15T00:00:00Z (Phase 0 pass 30 — Story 8.1 done via PR #98 (2026-05-14T20:10:20Z); Epic 8 in-progress; orphaned worktrees cleaned; story-8.1 remote branch deleted; Ready cells recomputed per STORY_FILTER=8.2)_
```

**NEW**:
```
_Last updated: 2026-05-15 (SCP amendment — Stories 9.2 and 9.3 added to calendar_early_overrides per sprint-change-proposal-2026-05-15.md, resolving 8.2↔9.2 deadlock; Phase 0 pass 30 baseline preserved for reference)_
```

#### 2b. Row for Story 9.2 (line 55)

**OLD:**
```
| 9.2 | 9 | daily_kpi_snapshots + cycle_summaries schemas + daily-aggregate cron + 5-min today partial refresh | backlog | #47 | — | — | 9.1, 7.8 | ❌ No (epic 8 not complete) |
```

**NEW:**
```
| 9.2 | 9 | daily_kpi_snapshots + cycle_summaries schemas + daily-aggregate cron + 5-min today partial refresh (CALENDAR-EARLY) | backlog | #47 | — | — | 9.1, 7.8 (calendar-early: after_epic=7 per SCP-2026-05-15) | ✅ Yes |
```

#### 2c. Row for Story 9.3 (line 56)

**OLD:**
```
| 9.3 | 9 | 5-surface query endpoints — audit root + daily summary + Atenção feed + Notável feed | backlog | #48 | — | — | 9.2 | ❌ No (epic 8 not complete) |
```

**NEW:**
```
| 9.3 | 9 | 5-surface query endpoints — audit root + daily summary + Atenção feed + Notável feed (CALENDAR-EARLY) | backlog | #48 | — | — | 9.2, 8.1 (calendar-early: after_epic=7 per SCP-2026-05-15) | ❌ No (9.2 not done) |
```

#### 2d. Row for Story 9.4 (line 57)

**OLD:**
```
| 9.4 | 9 | Search by SKU/EAN endpoint — primary investigation primitive | backlog | #49 | — | — | 9.3 | ❌ No (epic 8 not complete) |
```

**NEW:**
```
| 9.4 | 9 | Search by SKU/EAN endpoint — primary investigation primitive | backlog | #49 | — | — | 9.3 | ❌ No (9.3 not done) |
```

#### 2e. Row for Story 9.5 (line 58)

**OLD:**
```
| 9.5 | 9 | Firehose /audit/firehose — cycle-aggregated view with lazy-loaded SKU expansion | backlog | #50 | — | — | 9.3 | ❌ No (epic 8 not complete) |
```

**NEW:**
```
| 9.5 | 9 | Firehose /audit/firehose — cycle-aggregated view with lazy-loaded SKU expansion | backlog | #50 | — | — | 9.3 | ❌ No (9.3 not done) |
```

#### 2f. Row for Story 9.6 (line 59)

**OLD:**
```
| 9.6 | 9 | Audit-log archive job — detach old partitions per AD19 retention semantics | backlog | #51 | — | — | 9.1 | ❌ No (epic 8 not complete) |
```

**NEW** (accuracy correction — 9.6 spec body cites Story 10.1 dep, which is blocked on Story 8.11):
```
| 9.6 | 9 | Audit-log archive job — detach old partitions per AD19 retention semantics | backlog | #51 | — | — | 9.1, 10.1 | ❌ No (10.1 not done — itself blocked on 8.11) |
```

#### 2g. Dependency Chains section additions

**OLD** (lines 115-119):
```
- **9.2** depends on: 9.1, 7.8 (epic-ordering: epic 8 must be complete)
- **9.3** depends on: 9.2
- **9.4** depends on: 9.3
- **9.5** depends on: 9.3
- **9.6** depends on: 9.1
```

**NEW:**
```
- **9.2** depends on: 9.1, 7.8 (calendar-early: after_epic=7 per SCP-2026-05-15 — spec deps 9.0/9.1/5.2/4.1/4.2 all done; no Epic 8 surface dep)
- **9.3** depends on: 9.2, 8.1 (calendar-early: after_epic=7 per SCP-2026-05-15)
- **9.4** depends on: 9.3
- **9.5** depends on: 9.3
- **9.6** depends on: 9.1, 10.1 (10.1 is the substantive blocker — itself blocked on Story 8.11)
```

#### 2h. Current State notes addition

**Add new bullet to the "Current State (Phase 0 pass 30 ...)" section** at the appropriate position (after the Epic 8 status bullet):

**INSERT after line 139:**
```
- **SCP-2026-05-15 applied**: Stories 9.2 + 9.3 added to `calendar_early_overrides` (after_epic=7) per sprint-change-proposal-2026-05-15.md. Resolves the 8.2↔9.2 phantom deadlock surfaced when /bad 8.2 ran earlier today. 9.2 immediately Ready; 9.3 ready after 9.2 ships; 8.2 ready after 9.2 ships; 8.10 ready after 9.3 ships.
```

#### 2i. Ready-to-Work Analysis update

**OLD** (lines 153-164, immediate batch list):
```
**Ready to dispatch (all from `main`, not in merge_blocks, not calendar-early):**
- **8.3** — PT/ES channel toggle pill in sticky header. Depends on 8.1 (done). Epics 1-7 all done. ✅ Yes.
- **8.4** — Margin editor inline panel. Depends on 8.1 (done). ✅ Yes.
- **8.5** — Pause/Resume buttons + cron_state transitions. Depends on 8.1 (done) + 4.1 (done). ✅ Yes.
- **8.7** — Anomaly review modal (consumes Story 7.4 endpoints). Depends on 8.1 (done) + 7.4 (done). ✅ Yes.
- **8.8** — Banner library + UX4 stack precedence. Depends on 8.1 (done). ✅ Yes.
- **8.9** — Interception pages /key-revoked + /payment-failed. Depends on 8.1 (done). ✅ Yes.
- **8.11** — Settings sectioned navigation (5 pages). Depends on 8.1 (done). ✅ Yes.
- **8.12** — Mobile-focused critical-alert response surface. Depends on 8.1 (done). ✅ Yes.

**STORY_FILTER=8.2 — Assessment:**
- **8.2** — KPI cards row ... ❌ No (9.2 not done).
```

**NEW** (adds 9.2 to the immediate batch, retains accurate 8.2 assessment with updated reason for 9.2's readiness):
```
**Ready to dispatch (all from `main`, not in merge_blocks):**
- **8.3** — PT/ES channel toggle pill in sticky header. Depends on 8.1 (done). Epics 1-7 all done. ✅ Yes.
- **8.4** — Margin editor inline panel. Depends on 8.1 (done). ✅ Yes.
- **8.5** — Pause/Resume buttons + cron_state transitions. Depends on 8.1 (done) + 4.1 (done). ✅ Yes.
- **8.7** — Anomaly review modal (consumes Story 7.4 endpoints). Depends on 8.1 (done) + 7.4 (done). ✅ Yes.
- **8.8** — Banner library + UX4 stack precedence. Depends on 8.1 (done). ✅ Yes.
- **8.9** — Interception pages /key-revoked + /payment-failed. Depends on 8.1 (done). ✅ Yes.
- **8.11** — Settings sectioned navigation (5 pages). Depends on 8.1 (done). ✅ Yes.
- **8.12** — Mobile-focused critical-alert response surface. Depends on 8.1 (done). ✅ Yes.
- **9.2** (CALENDAR-EARLY per SCP-2026-05-15) — daily_kpi_snapshots + cycle_summaries + daily aggregate cron. All spec deps done (9.0, 9.1, 5.2, 4.1, 4.2). ✅ Yes.

**STORY_FILTER=8.2 — Assessment:**
- **8.2** — KPI cards row. Depends on 8.1 (done ✅) AND 9.2 (now calendar-early and Ready — but still backlog). ❌ No (9.2 must ship first; will Ready on next pass once 9.2 done).
```

#### 2j. Blocked list correction

**OLD** (lines 168-174, blocked section):
```
**Blocked:**
- **8.2** — depends on 9.2 which is blocked on epic 8 not complete. ❌ No.
- **8.6** — depends on 11.1 (epic 11, not started). ❌ No.
- **8.10** — depends on 9.3 (epic 9 remaining stories, require epic 8 complete). ❌ No.
- **9.2-9.6** — require epic 8 complete. ❌ No.
- **10.x, 11.x, 12.x** — blocked further downstream.
```

**NEW:**
```
**Blocked (post-SCP-2026-05-15):**
- **8.2** — depends on 9.2 (Ready but not yet done). ❌ No (will Ready once 9.2 ships).
- **8.6** — depends on 11.1 (epic 11, not started). ❌ No.
- **8.10** — depends on 9.3 (Ready blocker is 9.2 not done — same chain as 8.2). ❌ No.
- **9.3** — depends on 9.2 (Ready but not yet done). ❌ No.
- **9.4, 9.5** — depend on 9.3. ❌ No.
- **9.6** — depends on 10.1 (which depends on 8.11). ❌ No.
- **10.x, 11.x, 12.x** — blocked further downstream.
```

---

### Change 3 — `_bmad-output/planning-artifacts/epics-distillate/06-epics-9-10-audit-deletion.md`

#### 3a. Story 9.2 header + Notes

**OLD** (lines 80-82):
```
### Story 9.2: `daily_kpi_snapshots` + `cycle_summaries` schemas + daily-aggregate cron + 5-min "today" partial refresh
- **Trace:** Implements AD19 (precomputed aggregates), Story 8.2 KPI cards' data source; FRs FR34 partial (data); NFRs NFR-P8 (≤2s on 90-day window — aggregates make this feasible). Size M.
- **Bob-trace:** SSoT: `worker/src/jobs/daily-kpi-aggregate.js`, `worker/src/engine/kpi-derive.js` (cycle-end aggregation → cycle_summaries; consumed by Story 5.2's cycle-end hook). Migrations: `supabase/migrations/202604301209_create_daily_kpi_snapshots.sql`, `supabase/migrations/202604301210_create_cycle_summaries.sql`. Depends on Story 9.0 + Story 9.1 (audit_log foundation), Story 5.2 (cycle-end hook), Story 4.1 (customer_marketplace), Story 4.2 (sku_channels for tier-derived counts). Enables Story 8.2 KPI cards consume `daily_kpi_snapshots`; Story 9.5 firehose consumes `cycle_summaries`.
```

**NEW** (adds `[CALENDAR-EARLY — Story 8.x sibling]` marker + `Notes:` line):
```
### Story 9.2: `daily_kpi_snapshots` + `cycle_summaries` schemas + daily-aggregate cron + 5-min "today" partial refresh [CALENDAR-EARLY — Story 8.x sibling]
- **Trace:** Implements AD19 (precomputed aggregates), Story 8.2 KPI cards' data source; FRs FR34 partial (data); NFRs NFR-P8 (≤2s on 90-day window — aggregates make this feasible). Size M.
- **Notes:** [CALENDAR-EARLY — Story 8.x sibling] SHIPS DURING Epic 8 calendar window per SCP-2026-05-15. Spec deps (9.0, 9.1, 5.2, 4.1, 4.2) all done by start of Epic 8; no actual code dep on Epic 8 surfaces. Required for Story 8.2 (KPI cards) and Story 9.3 (5-surface audit query endpoints, which 8.10 reuses). `sprint-status.yaml` `calendar_early_overrides:` entry has `after_epic: 7` and `test_design_epic: 9` (Epic 9 test design already `done` from 9.0/9.1 calendar-early pass).
- **Bob-trace:** SSoT: `worker/src/jobs/daily-kpi-aggregate.js`, `worker/src/engine/kpi-derive.js` (cycle-end aggregation → cycle_summaries; consumed by Story 5.2's cycle-end hook). Migrations: `supabase/migrations/202604301209_create_daily_kpi_snapshots.sql`, `supabase/migrations/202604301210_create_cycle_summaries.sql`. Depends on Story 9.0 + Story 9.1 (audit_log foundation), Story 5.2 (cycle-end hook), Story 4.1 (customer_marketplace), Story 4.2 (sku_channels for tier-derived counts). Enables Story 8.2 KPI cards consume `daily_kpi_snapshots`; Story 9.5 firehose consumes `cycle_summaries`.
```

#### 3b. Story 9.3 header + Notes

**OLD** (lines 92-94):
```
### Story 9.3: 5-surface query endpoints — `/audit` root with Daily summary + Atenção feed + Notável feed
- **Trace:** Implements UX-DR7 (daily summary), UX-DR8 (Atenção feed expanded by default), UX-DR9 (Notável feed collapsed-by-default), UX-DR12 (every event accessible via search/firehose); FRs FR37, FR38, FR38b, FR38d; NFRs NFR-P8, NFR-A3, NFR-L1. Size L.
- **Bob-trace:** SSoT: `app/src/routes/audit/index.js` (`GET /audit`), `app/src/routes/audit/_fragments/atencao-feed.js`, `app/src/routes/audit/_fragments/notavel-feed.js`, `app/src/views/pages/audit.eta`, `app/src/views/components/audit-feeds.eta`, `shared/audit/readers.js` (query helpers for the 5 surfaces — single-source-of-truth for audit reads). Depends on Story 8.1 (chrome), Story 9.0 + Story 9.1 (audit foundation), Story 9.2 (daily_kpi_snapshots for the summary card). Enables Story 9.4 (search), Story 9.5 (firehose), Story 8.10 admin reuse via `?as_admin=`.
```

**NEW:**
```
### Story 9.3: 5-surface query endpoints — `/audit` root with Daily summary + Atenção feed + Notável feed [CALENDAR-EARLY — Story 8.x sibling]
- **Trace:** Implements UX-DR7 (daily summary), UX-DR8 (Atenção feed expanded by default), UX-DR9 (Notável feed collapsed-by-default), UX-DR12 (every event accessible via search/firehose); FRs FR37, FR38, FR38b, FR38d; NFRs NFR-P8, NFR-A3, NFR-L1. Size L.
- **Notes:** [CALENDAR-EARLY — Story 8.x sibling] SHIPS DURING Epic 8 calendar window per SCP-2026-05-15. Spec deps (8.1, 9.0, 9.1, 9.2) — 8.1 done, foundation done, 9.2 also calendar-early. No actual code dep on other Epic 8 surfaces. Required for Story 8.10 (admin /status reuses 9.3 via `?as_admin=`) and Story 8.7's "Ver histórico" link target. `sprint-status.yaml` `calendar_early_overrides:` entry has `after_epic: 7` and `test_design_epic: 9`.
- **Bob-trace:** SSoT: `app/src/routes/audit/index.js` (`GET /audit`), `app/src/routes/audit/_fragments/atencao-feed.js`, `app/src/routes/audit/_fragments/notavel-feed.js`, `app/src/views/pages/audit.eta`, `app/src/views/components/audit-feeds.eta`, `shared/audit/readers.js` (query helpers for the 5 surfaces — single-source-of-truth for audit reads). Depends on Story 8.1 (chrome), Story 9.0 + Story 9.1 (audit foundation), Story 9.2 (daily_kpi_snapshots for the summary card). Enables Story 9.4 (search), Story 9.5 (firehose), Story 8.10 admin reuse via `?as_admin=`.
```

---

### Change 4 — `_bmad-output/planning-artifacts/epics-distillate/_index.md`

#### 4a. Marker reference (line 40)

**OLD:**
```
- Markers: `[CALENDAR-EARLY — Story 1.x sibling]` annotations on Stories 9.0 and 9.1.
```

**NEW:**
```
- Markers: `[CALENDAR-EARLY — Story 1.x sibling]` annotations on Stories 9.0 and 9.1; `[CALENDAR-EARLY — Story 8.x sibling]` annotations on Stories 9.2 and 9.3 (added 2026-05-15 per SCP). Story 7.1 ships calendar-early via `sprint-status.yaml` override without an in-distillate marker.
```

#### 4b. Story-dependency check (line 330)

**OLD:**
```
Verified: every story's `Depends on:` line references only PRIOR-numbered stories (within the epic) OR stories from earlier epics (calendar-shipping order). Exception correctly documented: Story 9.0 + Story 9.1 ship calendar-early as Story 1.x siblings per Option A — this is the ONLY out-of-numerical-order shipping in the spec.
```

**NEW:**
```
Verified: every story's `Depends on:` line references only PRIOR-numbered stories (within the epic) OR stories from earlier epics (calendar-shipping order). Exceptions correctly documented via `sprint-status.yaml` `calendar_early_overrides:` block: Story 9.0 + Story 9.1 (Story 1.x siblings, after_epic=2), Story 7.1 (after_epic=1, added 2026-05-10), Story 9.2 + Story 9.3 (Story 8.x siblings, after_epic=7, added 2026-05-15 per SCP). All other stories follow numerical-order shipping.
```

---

### Change 5 — `project-context.md` — Calendar-Early Sequencing section append

**OLD** (lines 187-195):
```
**Stories 9.0 + 9.1 ship between Epic 2 and Epic 3 — NOT in Epic 9 timeline.**

Reason: audit-log infrastructure (event_types lookup, partitioned `audit_log` table, priority-derivation trigger, `writeAuditEvent` SSoT, `no-raw-INSERT-audit-log` ESLint rule, monthly partition cron) is needed before Epic 3+ events fire. Epics 5, 7, 10, 11, 12 all emit audit events; the foundation must exist when those epics ship.

Sprint-status.yaml reflects this; the markers `[CALENDAR-EARLY — Story 1.x sibling]` annotate Stories 9.0 and 9.1 in their epics-distillate definitions.

**Story 5.1 retrofit pragma for Story 9.1 cron**: Story 9.1's `worker/src/jobs/monthly-partition-create.js` cron uses Story 5.1 cron dispatcher with the literal `// safe: cross-customer cron` comment opt-out from the `worker-must-filter-by-customer` ESLint rule. This is preserved verbatim on Story 5.1 AND cross-referenced on Story 9.1.

**Loading consequence**: when Bob shards Story 9.0 or 9.1, load `epics-distillate/06-epics-9-10-audit-deletion.md` (where the story bodies live) — calendar-early refers to *shipping order*, not *file location*.
```

**NEW** (adds a paragraph describing the additional calendar-early stories):
```
**Stories 9.0 + 9.1 ship between Epic 2 and Epic 3 — NOT in Epic 9 timeline.**

Reason: audit-log infrastructure (event_types lookup, partitioned `audit_log` table, priority-derivation trigger, `writeAuditEvent` SSoT, `no-raw-INSERT-audit-log` ESLint rule, monthly partition cron) is needed before Epic 3+ events fire. Epics 5, 7, 10, 11, 12 all emit audit events; the foundation must exist when those epics ship.

Sprint-status.yaml reflects this; the markers `[CALENDAR-EARLY — Story 1.x sibling]` annotate Stories 9.0 and 9.1 in their epics-distillate definitions.

**Additional calendar-early overrides** (per `sprint-status.yaml` `calendar_early_overrides:` block — the authoritative source for what's exempt from the default lowest-incomplete-epic Ready-cell filter):

- **Story 7.1** (`after_epic: 1`, added 2026-05-10) — `shared/money/index.js` + `no-float-price` ESLint rule. Pure utility module; only Epic 1's eslint config required. Calendar-early treatment unblocked Bundle C deadlock.
- **Story 9.2** (`after_epic: 7`, added 2026-05-15 per `sprint-change-proposal-2026-05-15.md`) — `daily_kpi_snapshots` + `cycle_summaries` schemas + daily-aggregate cron. Required by Story 8.2 KPI cards. Spec deps (9.0/9.1/5.2/4.1/4.2) all done by start of Epic 8. Marked `[CALENDAR-EARLY — Story 8.x sibling]` in `epics-distillate/06-epics-9-10-audit-deletion.md`.
- **Story 9.3** (`after_epic: 7`, added 2026-05-15 per same SCP) — 5-surface audit query endpoints. Required by Story 8.10 admin reuse and Story 8.7 "Ver histórico" link. Marked `[CALENDAR-EARLY — Story 8.x sibling]`.

**Story 5.1 retrofit pragma for Story 9.1 cron**: Story 9.1's `worker/src/jobs/monthly-partition-create.js` cron uses Story 5.1 cron dispatcher with the literal `// safe: cross-customer cron` comment opt-out from the `worker-must-filter-by-customer` ESLint rule. This is preserved verbatim on Story 5.1 AND cross-referenced on Story 9.1.

**Loading consequence**: when Bob shards a calendar-early story, load `epics-distillate/06-epics-9-10-audit-deletion.md` (where the 9.x story bodies live) — calendar-early refers to *shipping order*, not *file location*.
```

---

## Section 5 — Implementation Handoff

**Classification:** Minor.

**Handoff target:** Pedro (solo developer) re-runs `npx tsx src/orchestrator/cli.ts start bad` from a fresh terminal after this SCP is approved and the file changes are committed.

**Expected behavior on next `/bad` run:**

1. **Phase 0** reads updated `sprint-status.yaml`.
2. **Phase 0** recomputes Ready cells. New state:
   - **9.2** → ✅ Ready (immediately dispatchable)
   - **9.3** → ❌ Blocked on 9.2 (will Ready once 9.2 ships)
   - **8.2** → ❌ Blocked on 9.2 (will Ready once 9.2 ships)
   - **8.10** → ❌ Blocked on 9.3 (will Ready once 9.3 ships)
   - **8.3, 8.4, 8.5, 8.7, 8.8, 8.9, 8.11, 8.12** → still ✅ Ready
3. **Dispatcher** picks per its heuristic. If `STORY_FILTER=8.2` is set, dispatcher reports 8.2 blocked on 9.2 not done (transitional, expected). If no filter, dispatcher picks from the 9-story ready batch — 9.2 should rank high given downstream unblocking value.
4. **Phase 1** for 9.2 skips Epic-Start (Epic 9's test_design_epic is `done`).
5. **Phase 0** regenerates `dependency-graph.md` from sprint-status — manual graph edits in this SCP serve as documentation; the regenerated graph will agree with the new sprint-status state.

**Success criteria:**

1. ✅ Sprint-status.yaml shows 5 entries in `calendar_early_overrides:` (9.0, 9.1, 7.1, 9.2, 9.3).
2. ✅ On next `/bad` run, Phase 0 dispatches 9.2 (or one of the other ready stories).
3. ✅ Once 9.2 merges, 8.2 + 9.3 become Ready on subsequent pass.
4. ✅ Once 9.3 merges, 8.10 becomes Ready.
5. ✅ No spec content changed; 9.2 and 9.3 acceptance criteria stand verbatim.

**Risk:** None at the spec/sprint level. The orchestrator's Phase 0 may regenerate `dependency-graph.md` and overwrite the manual annotations in Change 2 — that's expected and fine; the regeneration will agree with the new sprint-status truth.

**Deferred / out of scope of this SCP:**

- Audit of whether other dependency-graph epic-ordering annotations are over-blocking (e.g., 9.4, 9.5, 9.6 reasons updated for accuracy but no calendar-early added — they have legitimate spec-level blockers, not heuristic ones).
- Orchestrator-side: whether Phase 0's "epic-ordering" heuristic should be tightened to only apply when there's a genuine cross-epic spec dep, vs. uniformly to every Epic N+1 story. Worth a Phase 0/Phase 1.5 evolve-loop observation.

---

## Appendix — Why not Option A (placeholder KPI data)

For completeness, the rejected alternative:

**Option A:** Amend Story 8.2 to drop the hard dependency on 9.2; ship 8.2 with placeholder KPI data; add a follow-up story to wire the KPIs to `daily_kpi_snapshots` once 9.2 lands.

**Rejected because:**

1. **Story 8.2 AC3 already specifies graceful degradation** for the steady-state edge case (today's row not yet aggregated, before midnight refresh runs). Using that as the *normal* mode would mean the customer's KPI cards display `0 / 0 / 0` indefinitely until the follow-up ships — visually broken.
2. **Two-PR pattern for one feature** creates technical debt: 8.2 ships in a "looks-broken" state, has to be revisited, integration tests get rewritten when wire-up lands. Pedro's memory `feedback_no_premature_abstraction.md` and `feedback_orchestrator_pushes_back_on_bad_workarounds.md` both apply here — workaround instead of root-cause fix.
3. **The root cause isn't 8.2's spec — it's the dependency-graph's epic-ordering heuristic.** Fixing 8.2 leaves the heuristic in place; the same trap re-fires next time an Epic N+1 foundation story is needed before Epic N completes.

Option B (calendar-early 9.2 + 9.3) addresses the root cause with the smallest possible diff and leverages the mechanism Pedro already standardized for this exact problem.
