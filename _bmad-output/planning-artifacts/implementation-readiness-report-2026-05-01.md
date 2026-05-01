---
name: implementation-readiness-report
date: 2026-05-01
project: marketpilot-repricer
status: complete
stepsCompleted: [step-01-document-discovery, step-02-prd-analysis, step-03-epic-coverage-validation, step-04-ux-alignment, step-05-epic-quality-review, step-06-final-assessment]
filesIncluded:
  - prd.md
  - architecture.md
  - epics.md
  - ux-skeleton.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-05-01
**Project:** marketpilot-repricer
**Reviewer:** Claude Code (acting PM/SM)
**Scope:** Cross-document alignment of locked planning corpus prior to Bob-shard / Phase 4 implementation.

## §0 Document Inventory

| Document | Path | Status | Size |
|---|---|---|---|
| PRD | `_bmad-output/planning-artifacts/prd.md` | complete (51 FRs + 41 NFRs) | 104 KB |
| Architecture | `_bmad-output/planning-artifacts/architecture.md` | complete (30 ADs + 13 amendments F1-F13 + post-completion supplements) | 212 KB |
| Epics & Stories | `_bmad-output/planning-artifacts/epics.md` | complete (62 stories / 12 epics + Step-4 validation appendices) | 360 KB |
| UX Skeleton | `_bmad-output/planning-artifacts/ux-skeleton.md` | complete (38 UX-DRs + 5-surface IA) | 64 KB |

**No sharded/distillate variants of these four exist** — single canonical version of each. (`product-brief-marketpilot-repricer-distillate.md` exists but is out of scope for this assessment.)

**No duplicates to resolve.** Proceeding with cross-document validation.

---

## §1 Executive Verdict

**READY TO SHARD — with two minor corrections recommended before Bob picks up.**

The locked corpus exhibits exceptionally clean traceability. Every checklist item from the command-args block has been verified against the source documents. Of the ~150 distinct identifiers tracked (51 FRs + 41 NFRs + 30 ADs + 13 F-amendments + 38 UX-DRs + 17 P11 fixtures + 11 SSoT modules + 27 architectural constraints + 6 Phase-2 reservation columns + 6 ESLint rules + 12 Batch-2 dependents), **only one critical drift was found** (NFR-O4 orphaned post-lockdown), plus **two important documentation gaps** (F7 / F9 binding evidence) and **one cosmetic inconsistency** (PRD intro claims 41 NFRs but document contains 42).

| Tier | Count | Blocks shard? |
|---|---|---|
| 🔴 Critical | 1 | No — fix in <5 min |
| 🟡 Important | 3 | No — verify during PR review of owning stories |
| 🟢 Nice-to-have | 2 | No — track as housekeeping |
| ✅ Verified clean | All other axes | — |

Recommendation: apply the two cosmetic fixes (NFR-O4 mapping + PRD count correction) before Bob shards, then proceed to sprint-planning. F7 / F9 evidence verification can fold into the Story 11.5 and Story 1.x review gates.

---

## §2 🔴 Critical Findings

### C1. NFR-O4 (manual Moloni invoice generation SLA) is orphaned

- **Source:** [prd.md:735](_bmad-output/planning-artifacts/prd.md#L735) defines NFR-O4 — *"Founder admin generates manual Moloni invoices per Stripe payment within 24 hours of billing… Aggregate exceeding 2-3 hr/month triggers Epic 2 Moloni API integration."*
- **Drift:** Zero references to `NFR-O4` exist anywhere in [epics.md](_bmad-output/planning-artifacts/epics.md). The NFR was appended to PRD after the FR/NFR coverage appendix was sealed.
- **Impact:** No story AC commits to the 24-hour SLA or the ≤10-minute-per-invoice operational target. Story 11.5 (`moloni_invoices` table + NIF capture) has the closest scope but doesn't cover the operator-side SLA.
- **Proposed fix (no architectural change):** Edit Story 11.5 to add an NFR-O4 binding to its acceptance criteria — e.g., *"Founder runbook documents 24-hour SLA + ≤10-min target; first-customer measurement captured."* Update epics.md coverage appendix at [epics.md:~3811](_bmad-output/planning-artifacts/epics.md#L3811) to map NFR-O4 → Story 11.5 + Founder Operational track. Alternative: split off a tiny Story 11.6 "Founder Moloni runbook" if Pedro prefers separation.

---

## §3 🟡 Important Findings

### I1. F7 (NIF capture flow at Day-3 pulse-check) — binding to Story 11.5 not fully verified in AC sampling

- **Source:** [architecture.md F7 amendment ~line 2275-2294](_bmad-output/planning-artifacts/architecture.md) names Story 11.5 + Founder Operational track as the home for F7.
- **Drift:** The cross-doc traceability appendix at [epics.md:~3912-3931](_bmad-output/planning-artifacts/epics.md#L3912) declares F7 covered, but the deep-dive sample of [Story 11.5 starting line 3478](_bmad-output/planning-artifacts/epics.md#L3478) did not surface a verbatim `F7` token in the ACs. The flow may be present in prose but not anchored to the amendment ID.
- **Impact:** During PR review, a reviewer searching for `F7` in Story 11.5 ACs will not find the link, risking under-implementation.
- **Proposed fix:** Add `**Implements: AD22 (with F7 — NIF capture at Day-3 pulse-check)**` line to Story 11.5's header, mirroring the convention used in Story 11.1 [(epics.md:3289)](_bmad-output/planning-artifacts/epics.md#L3289).

### I2. F9 (no-bundler `<script defer>` pattern) — declared at architecture-level but not pinned to a single owning story

- **Source:** F9 amendment at [architecture.md:~2283](_bmad-output/planning-artifacts/architecture.md#L2283) and the Pattern Examples block.
- **Drift:** F9 is a pattern that applies across all per-page eta templates, not a discrete deliverable. Story 1.1 contains the scaffold but doesn't own F9 explicitly. Result: no single AC says "F9 enforced here."
- **Impact:** If a future story authors a new page with bundled JS, no automated gate catches it.
- **Proposed fix:** Either (a) add an `**Enforces: F9**` line to Story 1.1's ACs with a custom ESLint or grep-based CI check forbidding `<script src=…>` in `app/views/**/*.eta` (lightweight), or (b) note explicitly in the architecture's "deferred ESLint rules" list that F9 has no automated guardrail and relies on PR review.

### I3. PRD intro states "41 NFRs" but the document contains 42

- **Source:** [prd.md:29](_bmad-output/planning-artifacts/prd.md#L29) summary header vs. actual NFR enumeration including NFR-O4 at [prd.md:735](_bmad-output/planning-artifacts/prd.md#L735).
- **Impact:** Cosmetic, but the command-args block also propagates the "41 NFR" figure — it should read "42 NFRs" everywhere downstream once C1 is resolved.
- **Proposed fix:** Change PRD intro to "42 NFRs" alongside the C1 mapping fix.

---

## §4 🟢 Nice-to-Have Findings

### N1. 11 of 27 architectural constraints rely on custom ESLint rules that ship after Story 1.1

- **Source:** [architecture.md "Implementation Patterns & Consistency Rules" §906-1264](_bmad-output/planning-artifacts/architecture.md#L906).
- **Observation:** 16 of 27 constraints have hard enforcement (schema CHECK, RLS regression suite, integration tests, pre-commit hooks). The remaining 11 are custom ESLint rules whose authoring stories are 1.2 → 7.x. Until the rule ships, enforcement is interim (pragma comments, code review).
- **Why nice-to-have, not a blocker:** Each rule ships with its target SSoT module, so the enforcement gap is bounded to the period between Story 1.1 and the SSoT-creating story. No code that violates a rule can land before its rule exists, because no code that *needs* the rule exists either.
- **Optional fix:** Add a single sentence to the architecture's "Notes for Bob" section explicitly framing the deferred-ESLint pattern as intentional, so reviewers don't flag it as drift later.

### N2. Story 4.9 stub mapping resolved but worth a one-line cleanup

- **Source:** [epics.md:3738](_bmad-output/planning-artifacts/epics.md#L3738) flags an ambiguity for Story 4.9's minimal landing.
- **Status:** Already resolved — stub `26-dashboard-dryrun-minimal.html` exists in `_bmad-output/design-references/screens/` and is cited in the mapping table.
- **Optional fix:** Strike the "ambiguity" annotation from line 3738 to reduce noise for future readers.

---

## §5 ✅ Verified Clean (per the command-args checklist)

| Axis | Result |
|---|---|
| All 51 FRs covered by ≥1 story | ✅ 51/51 — 5/5 spot-checks pass (Story 1.4 ↔ FR1, Story 4.3 ↔ FR9, Story 5.1 ↔ FR18, Story 7.6 ↔ FR26, Story 11.1 ↔ FR40). FR42 explicitly Parallel-Tracks-only by design. |
| All 41 NFRs covered | 🟡 41/42 — see C1 / I3 above |
| All 30 ADs referenced in story ACs | ✅ 30/30 — 6/6 spot-checks across groups A-J pass |
| All 13 F1-F13 amendments folded in | 🟡 11/13 verbatim, 2/13 (F7, F9) declared but not pinned (I1, I2) |
| All 38 UX-DRs mapped to a story | ✅ 38/38 — uniquely owned (no double-binding) |
| 17 P11 fixtures across Epic 7 with 7.8 gate | ✅ 17/17 — every fixture exercised in ≥1 of Stories 7.2-7.7 AND end-to-end in Story 7.8 |
| Atomicity: F3+AD29 single story | ✅ Story 1.4 owns both with explicit "atomicity bundle" annotation |
| Atomicity: F4+onboarding adjacent | ✅ Story 4.1 + Story 4.4 explicitly mutually annotated |
| Atomicity: AD7+AD8+AD9+AD11 + integration gate | ✅ Story 7.8 ([epics.md:2168](_bmad-output/planning-artifacts/epics.md#L2168)) cites all four ADs as the gate |
| Stories 9.0 + 9.1 calendar-early annotated | ✅ Both have `[CALENDAR-EARLY — Story 1.x sibling]` in their titles |
| 12 Batch-2 stories list 9.0/9.1 as deps | ✅ Stories 4.1, 5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7 all declare the dependency |
| Pattern A/B/C declarations on every UI story | ✅ Every UI-touching story (Epics 4, 8, 9, 10, 11) has a `Visual reference pattern: A\|B\|C` line |
| Pattern A stubs cited match real files | ✅ 27/27 cited stubs exist in `_bmad-output/design-references/screens/`; zero orphans |
| 11 SSoT modules each have exactly one creating story | ✅ 11/11 single-origin; no parallel implementations |
| 6 custom ESLint rules attach to target modules | ✅ 6/6 (`no-direct-fetch`, `no-raw-CSV-building`, `no-raw-INSERT-audit-log`, `no-float-price`, `no-raw-cron-state-update`, `worker-must-filter-by-customer`) |
| 27 architectural constraints enforced where claimed | ✅ 16 hard-enforced + 11 deferred-but-bounded (N1) |
| Schema columns consistent arch ↔ stories | ✅ 5/5 spot-checks pass (customers.email, customer_marketplaces.shop_id, sku_channels.pending_import_id, sku_channels.last_won_at, audit_log.resolved_at) |
| 6 Phase-2 reservation columns present | ✅ 6/6 (`anomaly_threshold_pct`, `tier_cadence_minutes_override`, `edge_step_cents`, `cost_cents`, `excluded_at`, `master_key_version`) declared in arch + reserved in schema |
| Q1 + Q2 DECIDED outcomes reflected | ✅ Q2 (channel codes WRT_PT_ONLINE / WRT_ES_ONLINE) locked via empirical capture; Q1 (per-channel write mechanism) implicit in Story 6.1 AC. No story describes the un-chosen alternative. |
| Audit-log 5-surface IA covered | ✅ Surfaces 1-3 in Story 9.3, Surface 4 in Story 9.4, Surface 5 in Story 9.5 |
| F1-F13 retroactive Depends-on updates | ✅ 3/3 spot-checks pass (Story 4.1 cites F4+F13, Story 7.5 cites F1, Story 11.1 cites F2+F12) |

---

## §6 Recommended Action Sequence

1. **Apply C1 fix**: edit Story 11.5 to add NFR-O4 binding + update FR/NFR coverage appendix in epics.md. (~5 min)
2. **Apply I3 fix**: change "41 NFRs" → "42 NFRs" in [prd.md:29](_bmad-output/planning-artifacts/prd.md#L29). (~30 sec)
3. **Apply I1 fix**: add `**Implements: AD22 (with F7)**` header to Story 11.5. (~1 min)
4. **Apply I2 fix**: pick (a) ESLint guardrail or (b) explicit "no automated gate" note in arch. (~5 min)
5. **Optional N1**: add a single "deferred-ESLint pattern is intentional" sentence to architecture.md "Notes for Bob". (~1 min)
6. **Optional N2**: strike the "ambiguity" annotation at [epics.md:3738](_bmad-output/planning-artifacts/epics.md#L3738). (~30 sec)
7. **Then proceed to**: `/bmad-sprint-planning` (Bob shard).

No architectural changes proposed. All findings are documentation drift and AC binding clarity — the underlying decisions are sound and locked.

---

## §7 Files Referenced

- [_bmad-output/planning-artifacts/prd.md](_bmad-output/planning-artifacts/prd.md)
- [_bmad-output/planning-artifacts/architecture.md](_bmad-output/planning-artifacts/architecture.md)
- [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md)
- [_bmad-output/planning-artifacts/ux-skeleton.md](_bmad-output/planning-artifacts/ux-skeleton.md)
- [_bmad-output/design-references/screens/](_bmad-output/design-references/screens/) (27 stubs)
