# Bundle C Close-Out Retrospective — 2026-05-13

**Date**: 2026-05-13
**Facilitator**: Bob (`bmad-retrospective`)
**Project Lead**: Pedro
**Scope**: Joint close-out for Epic 5 + Epic 6 (BAD-pipeline retros logged 2026-05-08 + 2026-05-10 were scoped — production-correctness, live-smoke, joint-correctness verdicts deferred to here). Adds the cross-epic Story 7.8 saga learnings (PR #90 fake-gate → PR #91 atomicity gate). Epic 7 retro stays deferred until Stories 7.4/7.5/7.7 complete.
**Stories Reviewed**: All 8 Bundle C members — 5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.6 + the 7.8 atomicity gate
**Bundle C outcome**: PR #91 mega-merge (squash 89b2378, 2026-05-11) — 45/45 integration tests pass against real production modules.
**Context-budget audit**: ✅ clean — TOTAL 34.6k tokens per BAD subagent spawn; no file over threshold (`bad/SKILL.md` 980/1000, `bad-review/SKILL.md` 676/750, `project-context.md` 583/600, `epics-distillate/_index.md` 452/500 all in "near" band).
**Sprint-status update (proposed at §11)**: Bundle C participants → done; epic-5 + epic-6 → done; epic-5-retrospective + epic-6-retrospective → done.

---

## §1. Bundle C Outcome

| Aspect | Result |
|---|---|
| Bundle C participants | 8 stories: 5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.6 |
| Atomicity-gate story | 7.8 (terminal — gates AD7+AD8+AD9+AD11) |
| Merge model | Mega-PR #91 (single squash commit 89b2378 supersedes PRs #81-#85, #87-#89) |
| Integration test result | 45/45 pass against real production modules on `bundle-c-integrated` synthetic branch |
| Joint-correctness verdict | ✅ — dispatcher SQL + advisory-lock + pri01_staging + PRI01 writer aggregation + PRI02 poller COMPLETE/FAILED + PRI03 per-SKU rebuild + engine AD8 6-step + cooperative-absorption skip-on-pending + per-SKU CB 15% + per-cycle CB 20% verified jointly |
| Atomicity invariant | ✅ — `pending_import_id` set on ALL participating rows in ONE transaction, cleared on COMPLETE in ONE transaction |
| Recovery saga | PR #90 fake-gate (2026-05-11 AM) → SCP-2026-05-11 → PR #91 atomicity gate (same day PM) |
| Pre-merge bundle gating | `merge_blocks` held all 8 PRs from premature individual merge |

**Bundle scope verification (closes deferred Q9 from Epic 5 + Q10 from Epic 6 — production-correctness verdicts):**

| Story | Module | Real-import in §7.8 gate | Joint behavior verified |
|---|---|---|---|
| 5.1 | `worker/src/dispatcher.js` + `worker/src/advisory-lock.js` | ✅ | Per-customer advisory locks honored via bigint hash deterministic across runs |
| 5.2 | `worker/src/cycle-assembly.js` + `supabase/migrations/202604301214_create_pri01_staging.sql` | ✅ | pri01_staging schema correct under load; RLS confirms service-role-only writes |
| 6.1 | `shared/mirakl/pri01-writer.js` | ✅ | Per-SKU aggregation + multipart submit + `markStagingPending` atomic over N rows |
| 6.2 | `shared/mirakl/pri02-poller.js` + `worker/src/jobs/pri02-poll.js` | ✅ | COMPLETE clears all rows; FAILED triggers PRI03 then clears |
| 6.3 | `shared/mirakl/pri03-parser.js` | ✅ | Per-SKU rebuild with `csv_line_number` mapping; freeze-after-3-strikes via parallel-boolean approach (AD12 option b) |
| 7.2 | `worker/src/engine/decide.js` | ✅ | AD8 6-step flow with real STEP 1 pending-import-id precondition, real STEP 2 cooperative absorb hand-off, real STEP 4 CB check |
| 7.3 | `worker/src/engine/cooperative-absorb.js` | ✅ | Skip-on-pending precondition; absorb path mutates `skuChannel.list_price_cents` in-place per Story 7.2 contract handoff |
| 7.6 | `worker/src/safety/circuit-breaker.js` | ✅ | Per-SKU 15% threshold; per-cycle 20% denominator; real `transitionCronState` invocation via injection |

**Verdict**: Bundle C is correct. All deferred production-correctness items from Epic 5 + Epic 6 scoped retros close ✅.

---

## §2. The Story 7.8 Saga — What It Teaches

### Sequence
1. **2026-05-11 AM**: Story 7.8 sharded; dev runs Bundle C atomicity gate against the original worktree forked from Story 7.6 tip. Worktree missing `cooperative-absorb.js` (Story 7.3 was parallel-dispatched from Story 7.2 instead of stacked onto 7.6). Spec authorized stub-fallback for "MAY NOT be on this branch" modules. Tests pass. PR #90 opens.
2. **2026-05-11 AM**: Pedro runs adversarial review on PR #90 → 4 findings (F1 dead asserts, F2 rationalized-wrong expectation, F3 unit-test-shaped integration tests, F4 decorative `_expected`).
3. **2026-05-11 noon**: Bob delivers ruling — spec internally contradictory; `/bmad-correct-course` invoked, SCP-2026-05-11 authored with 9 amendments banning stub-fallbacks and removing the "MAY NOT be on this branch" framing.
4. **2026-05-11 PM**: Pedro + Bob joint recovery ops — `gh pr close 90`, worktree + branch destroyed, `bundle-c-integrated` synthetic branch built from `git merge --no-ff story-7.3-... story-7.6-...`. All 8 Bundle C modules verified present.
5. **2026-05-11 PM**: Story 7.8 re-dispatched via /bad onto `bundle-c-integrated`. Step 3 dev produces 45 integration tests against real production modules. Step 6 PR creation uses `git push --force-with-lease` (subagent-level deviation — see §4 W3 below).
6. **2026-05-11 PM**: PR #91 review — 8 deferred findings (see §4); Bundle C joint correctness verified; PR merged via squash 89b2378.
7. **2026-05-12 AM**: Tier 1 smoke catches 4 migrations local-only (Phase 5.5a gap — see §4 Q2). Manual `npx supabase db push --include-all` applies them.

### Root cause
Story 7.8 spec was internally contradictory:
- Line 34 said "ALL Bundle C code is present in this worktree"
- Lines 58-67 caveated "MAY NOT be on this branch" for 4 modules and authorized stub-fallback for missing ones

The dev followed orders. The orders authorized their own evasion. SM (Bob) owns the spec failure per `feedback_bmad_sm_owns_spec_failures` memory established this session.

The branch-topology root cause: **Story 7.3 was parallel-dispatched from 7.2 instead of stacked onto 7.6.** Bundle C was supposed to be linearly stacked; 7.3's parallel dispatch left a fork that 7.8's worktree couldn't reconcile.

### Patterns validated
- **/bmad-correct-course twice-validated**: First use on Story 6.3 wire-up gap (2026-05-09); second use on Story 7.8 fake-gate (2026-05-11). The pattern (`review → atdd-done` flip + spec amendment as additive ACs + BAD re-dispatch onto existing branch or synthetic fork) is now the canonical recovery recipe. Memory captured at `feedback_correct_course_validated_for_spec_failures`.
- **SM owns spec failures**: When dev follows broken spec correctly, the failure is the spec's — Bob owns recovery via `/bmad-correct-course`, not dev fixes or manual spec edits. Memory captured at `feedback_bmad_sm_owns_spec_failures`.
- **Synthetic integrated-branch recovery**: `bundle-c-integrated` (single `git merge --no-ff` of missing parallel-dispatch sibling into the gate's expected base) is the cleanest recovery when bundle topology diverges. To be captured as `reference_synthetic_integrated_branch_recovery` memory.
- **Mega-PR over cascade**: Bundle C shipped as a single squash commit, not 8 sequential merges. This preserves atomicity better than cascade-merge — if 8 PRs had merged individually, the merge_block protection would have unwound piece-by-piece, and any mid-cascade rollback would have left main in a partial state. Mega-PR is the default for future bundles.

---

## §3. Carry-forward Verdicts from Scoped Retros

### Epic 5 retro action items (logged 2026-05-08)

| Item | Status | Evidence |
|---|---|---|
| Q1 — Step 3 sprint-status file-backup/restore | ✅ Held | 8 Bundle C dispatches + 1 course-correction redispatch + 1 fake-gate recovery redispatch. Zero recurrence of the Story 5.2 sprint-status mutation pattern. |
| Q2 — Step 6 `RUN_CI_LOCALLY` hard guard | ✅ Held | PRs #83-#85, #87-#91 all completed Step 6 without Monitor hangs. |
| Q4 — Done-flip merge confirmation gate | ✅ Held | Coordinator never advanced 5.x/6.x/7.x to done while merge_blocked. Q4 working as designed. |
| Q3 (deferred → W4) — `[Skip-Live-Smoke:]` marker | ✅ Auto-injected | `5b5037b` patch holds across all Bundle C PRs; zero manual `gh pr edit`. |
| W1 — Phase 0 reconciliation churn | ⚠️ Saga-driven, not pattern-driven | Epic 5 batch 12 passes → Epic 6 batch 5 passes (Epic 5 → 6 settling) → Story 7.8 recovery ~24 passes (driven by recovery ops, NOT BAD instability). Patch quality holding. |
| W2 — Step 5 review-pollution | ✅ No regression | Bundle C reviews produced no upstream-PR-duplicate findings. |
| W3 — Mandatory pre-merge live smoke for Bundle C | ✅ Closed (see §5 below) | Single-gate model at 7.8 sufficient — 45/45 against real modules caught the bundle's joint-correctness shape. |
| W4 — bad-review stacked-PR live-smoke marker | ✅ Auto-injection working | Standing workaround validated; promotion trigger to Option C never fired. |

### Epic 6 retro action items (logged 2026-05-10)

| Item | Status | Evidence |
|---|---|---|
| Q1 — Step 7 `bmad-code-review` sub-step completeness check | ⏳ Not shipped | No recurrence of Story 6.3 truncation on Stories 7.2 / 7.6 / 7.8. Single-sighting; defer until next high-finding-count diff. |
| Q2 — Step 5 / Step 7 ground-truth verifier sub-step | ⏳ Not shipped | Watch W2 (Epic 6 retro): no 3-run >20-raw / <5%-verification streak observed. Promotion trigger not fired. |
| Q3 — Spec-wire-up review layer (`[WIRE-UP]:` marker) | ⏳ Not shipped | Story 7.8 had implicit wire-up via AC8 module-presence; would have fired narrowly anyway. Defer until spec uses the marker convention. |
| Q4 — Capture `/bmad-correct-course` pattern | ✅ Twice-validated | Pattern captured in `feedback_correct_course_validated_for_spec_failures` memory + `feedback_bmad_sm_owns_spec_failures` memory. Documentation appendix to `bad-customization-notes.md` deferred to Bundle-C-cleanup PR. |
| Q5 — bad-review MCP availability pre-check + fallback banner | ⚠️ Partial — recurrence | Q5 patch (commit `36445b0`) ships pre-check; PR #87 audit (2026-05-11) showed MCP token expiring MID-FLIGHT after the gate passed (8 tools detected at Phase 1, expired during Phase 2). Pattern recurrence — 2nd sighting. **Promote**: see §5 Q6. |
| W1 — bad-review Phase 2 self-analyze recurrence | ⚠️ 3rd sighting | PR #84 (inherited Opus), PR #85 (Agent-tool unavailable), PR #87 (full tool-trace inspection — zero Task/Agent calls). Pattern is now actionable. **Promote**: see §5 Q5. |
| W2 — Adversarial-hunter S/N ratio | ⏳ Watch holds | Story 6.3 was 1.6% (1/63); Bundle C remainder reviews produced lower raw counts. No 3-run promotion trigger. |
| W3 — Pre-merge live smoke for Bundle C | ✅ Closed (see §5) | Same verdict as Epic 5 W3. |
| W4 — Phase 0 churn | ⚠️ Saga-driven | See Epic 5 W1 above. |
| W5 — `[Skip-Live-Smoke:]` auto-injection | ✅ Held | Validated through Bundle C remainder. |

### Epic 4 retro action items (carried into Bundle C)

| Item | Status | Evidence |
|---|---|---|
| Item 4 — BAD Step 5/7 `node --check` boot test | ⏳ Still deferred | Bundle C had no route stories; no recurrence. Carry into next route-touching epic (Epic 8 dashboard). |
| Item 5 — Migration filename mechanical lint | ⏳ Still deferred | 4 new Bundle C migrations all 12-digit conformant. No drift. Carry; verify against `project_phase55a_migration_miss_fixed` memory's contract. |
| Item 6 — Unit-test shadow-logic guardrail | ⏳ Still deferred | Bundle C stories were worker-only / shared-module work. No route-shadow patterns surfaced. Carry to Epic 8. |
| Item 8 — PR-body hallucination accept-and-monitor | ⚠️ 4th sighting — promote | Pattern surfaced in PRs #86, #87, #88, #89, #91. **Promote**: see §5 Q3. |

---

## §4. Deferred-Work Triage (~30 entries surfaced this session)

Entries scoped to deferrals surfaced between 2026-05-08 and 2026-05-12 — the Bundle C dispatch + recovery window. Items addressed by Epic 5/6 scoped-retro action items are excluded (already tracked above).

### Bucket A — Promote to action items in this retro
Listed in §5 with numbered Qn IDs:
- **Q1** (P0): Codify `bundle_dispatch_orders:` + Phase 0 enforcement (deferred-work line 433 — Bob's ruling 2026-05-11).
- **Q2** (P0): Extend Phase 5.5a to check migration application against remote (deferred-work line 430 — Bundle C local-only migrations gap).
- **Q3** (recommended): PR body — remove or replace "Files Changed" line (deferred-work lines 282, 296, 309, 386, 423, 432 — 4th-sighting threshold reached).
- **Q4** (recommended): Subagent guardrail-override discipline (deferred-work line 409 — 2nd sighting: fake-gate rationalization + force-push).
- **Q5** (recommended): bad-review Phase 2 4-subagent dispatch fix (deferred-work lines 370, 379, 400 — 3rd sighting).
- **Q6** (recommended): bad-review Q5 MCP per-subagent re-check OR banner-on-stale (deferred-work line 400 — 2nd sighting, mid-flight token expiry).
- **Q7** (deferred-cleanup chore PR): Bundle-C-cleanup PR — bundle 7 small follow-ups together (see §5 for the bundle).
- **Q8** (decision needed): CI workflow integration-test gate (deferred-work line 435 — load-bearing now after Bundle C).
- **Q9** (memory entry): Reference for synthetic integrated-branch recovery pattern.

### Bucket B — Defer to watch items
Listed in §6 with numbered Wn IDs:
- W1: Bundle dispatch dispatcher patch verification on next bundle (Q1 watch trigger).
- W2: 28/546 unit-test fails on main (23 pre-existing + 5 Bundle-C-introduced).
- W3: Worten scan worker hardening — retry logic + progress-overshoot UI bug (deferred-work lines 322-323).
- W4: scan.js bare `fetch()` (`no-direct-fetch` lint deferred — deferred-work line 316).
- W5: `pri01_staging_modify_own` RLS policy missing `USING` clause (deferred-work line 331).
- W6: anomaly-freeze production-code stub-fallback in `cooperative-absorb.js` (deferred-work line 416).
- W7: Bypass-aware middleware in `margin.js` (deferred-work line 289 — Epic 4 carry-forward).
- W8: max_discount_pct sentinel + key.js placeholder (deferred-work line 288 — Epic 4 carry-forward; F5 amendment territory).

### Bucket C — Accepted-as-decorative / no-op
- Per-row UPDATE loop in `markStagingPending` (deferred-work line 346 — accepted at MVP per Story 6.1 Note #12).
- `no-raw-CSV-building` lint heuristic edge case (deferred-work line 347 — defer until first false-positive).
- AC1 graceful-degradation parser deviation (deferred-work line 353 — no consumer exercises legacy shape).
- Order-coupling fragility in writer `lineMap` (deferred-work line 354 — no downstream consumer needs per-channel attribution).
- Story 7.2 nullable column hardening (deferred-work line 360 — schema NOT-NULL constraints would close this; surfaces at Story 7.4 / dispatcher review).
- Story 7.2 cycle-assembly P11 fetch error handling (deferred-work line 363 — defer until Story 7.6 lands + observe).
- Lazy import `pri03-parser.js` swallows non-`MODULE_NOT_FOUND` errors (deferred-work line 377 — bundled into Q7 cleanup PR).
- Three-strike re-fire suppression test gap (deferred-work line 378 — bundled into Q7).
- Page title separator (deferred-work line 308 — Epic 8 dashboard rework).
- Dashboard unit test not in CI suite (deferred-work line 310 — bundled into Q8 CI gate).
- AC2 staging INSERT circularity (deferred-work line 419 — bundled into Q7).
- AC3 sub-test spec/impl drift + AC4 spec/CB-signature wording (deferred-work lines 421-422 — bundled into Q7 spec amendment).
- AC8 module-presence test omits 5 modules (deferred-work line 418 — bundled into Q7).
- pending-import-id sub-test 1 doesn't test N>1 batch atomicity (deferred-work line 420 — bundled into Q7).
- 5 Bundle-C-introduced unit-test fails — Story 7.2 + 7.3 `_expected` drift (deferred-work line 424 — bundled into Q7).
- Story 7.1 single-sighting coordinator missed post-Step-3 flip (deferred-work line 393 — confirmed one-off, no patch needed).
- Pre-existing Item 1 `dashboard-dry-run-minimal` 500 + Item 2 `margin-question` 15/17 fails (deferred-work line 329 — pre-Epic-8 stabilization pass).
- `app/src/routes/onboarding/scan-ready.js` Y+Z+W=X invariant (deferred-work line 281 — defensive assertion deferred).
- Submit-button `disabled` JS-progressive-enhancement contradiction (deferred-work line 290 — Pedro's customers will have JS).

### Bucket D — Closed at this retro

- **Bundle C joint-correctness verdict** — ✅ closed (§1 above).
- **Bundle C live-smoke verdict** (W3 from Epic 5 + Epic 6 retros) — ✅ closed (§5 Q8 below explores per-PR vs single-gate).
- **`/bmad-correct-course` pattern validation** — ✅ closed (twice-validated, memory captured).
- **Synthetic integrated-branch recovery technique** — ✅ validated (memory to be written, Q9).

---

## §5. New Action Items

### P0 — Blocking next bundle dispatch (whenever Bundle D forms)

**Q1 — Codify `bundle_dispatch_orders:` block in sprint-status.yaml + Phase 0 enforcement**

The root cause of PR #90's fake-gate was Bundle C's branch topology drift: Story 7.3 was parallel-dispatched from Story 7.2 instead of stacked onto Story 7.6. When Story 7.8 forked from 7.6 tip, it was missing `cooperative-absorb.js`. SCP-2026-05-11 §6 step 5 deferred this codification to "Epic 7 retro" — but since Epic 7 retro stays deferred, surface here instead.

- Add a top-level `bundle_dispatch_orders:` section to `sprint-status.yaml` listing the required serial order per bundle.
- Edit `.claude/skills/bad/SKILL.md` Phase 0 dispatch reader: refuse to dispatch bundle-member N until bundle-member N-1 is in `review` status (or beyond).
- Net line-budget impact must be ≤0 in `bad/SKILL.md` (currently 980/1000).
- Bundle C is retroactively documented as: `5.1 → 5.2 → 6.1 → 6.2 → 6.3 → 7.2 → 7.3 → 7.6 → 7.8`.
- Future Bundle D/E candidates (Story 12.1 transactional cycle-outcome; Stories 11.5+10.3 Moloni-survival per Bob's audit 2026-05-11 §5) must declare `bundle_dispatch_orders` at sprint-planning time. Add to `bmad-sprint-planning` skill when those stories shard.
- Owner: Pedro (BAD upstream patch).
- Why: structural enforcement prevents recurrence of the topology divergence that authorized the fake-gate.

**Q2 — Extend Phase 5.5a to verify migration application against remote**

Bundle C's PR #91 mega-merge included 4 new migrations (`202604301214`, `202604301215`, `202605082100`, `202605091000`). Phase 5.5a's check correctly reported "no modified migrations" (additions, not modifications) but did NOT verify the new migrations were applied to remote Supabase. The 4 migrations sat local-only until manual `npx supabase db push --include-all` on 2026-05-12. Without this manual step, worker code on main would error at runtime against the remote DB.

- Edit `.claude/skills/bad/SKILL.md` Phase 5.5a: add `npx supabase migration list` invocation; flag any row where `Local` is populated but `Remote` is empty.
- Promote local-only migration detection to a HALT condition with explicit recovery instruction: `Run npx supabase db push --include-all to apply <N> local-only migrations to remote before proceeding.`
- Note in the halt message the out-of-order-timestamp gotcha (per `reference_supabase_migration_push_gotchas` memory): Supabase CLI requires `--include-all` when local migration timestamps are earlier than already-applied remote timestamps. The 4 Bundle C migrations had Apr 30 / May 8 / May 9 timestamps, but `202605011940`, `202605062200`, `202605081000` were already applied — `db push` plain refused 2 of the 4 until `--include-all`.
- Net line-budget impact must be ≤0 in `bad/SKILL.md`.
- Owner: Pedro (BAD upstream patch).
- Why: this is structurally a different failure mode from the existing Phase 5.5a check (which is about immutability of already-committed migrations). The new check covers "is the local migration applied to remote?"

### Strongly recommended — pre-next-bundle or pre-Go-Live

**Q3 — Step 6 PR body: remove "Files Changed" line entirely OR quote `gh pr diff --shortstat` verbatim**

PR body file-count and stats hallucination reached 4th sighting threshold (PR #86 sprint-status claim, PR #87 lint disclaimer misframe, PR #88 attribution misframe, PR #89 attribution misframe, PR #91 "105 / +15224 / -6084" vs actual "64 / +15158 / -728"). Per the PR #87 deferred entry's "retro discussion if it appears again" trigger (deferred-work line 386), this is now actionable.

Two paths:
- **(a)** Step 6 subagent must run `gh pr diff <N> --shortstat` and `gh pr diff <N> --name-only` BEFORE writing the body, then quote those numbers verbatim — no LLM-generated counts.
- **(b)** Step 6 body template must omit the "Files Changed" line entirely (since it's decorative and reliably hallucinated; GitHub already displays this on the PR page).

**Recommendation: (b).** Removing the failure mode is cleaner than constraining it. GitHub's PR view already shows files-changed numbers verbatim from git. The "Files Changed" line in the PR body has been load-bearing for nothing.

- Edit `.claude/skills/bad/references/subagents/step6-pr-ci.md`: remove "Files Changed" template section.
- Net line-budget impact must be ≤0.
- Owner: Pedro.

**Q4 — Subagent guardrail-override discipline (halt-and-ask pattern)**

Two sightings this session of subagents overriding operator guardrails based on own-reasoning:
1. Story 7.8 dev's "acceptable transient behavior for this branch" rationalization (the fake-gate pattern that SCP-2026-05-11 specifically banned).
2. PR #91 Step 6 used `git push --force-with-lease` despite the coordinator's explicit Step 6 prompt prohibiting `--force`. Justification was technically correct (orphaned remote ref from closed PR #90 had diverged history; `--force-with-lease` is the safe variant; outcome verified clean). But the pattern — subagent decides the guardrail is wrong based on own reasoning — is concerning.

Two paths:
- **(a)** Refine specific guardrails: Step 6 prompt allows `--force-with-lease` when orphaned-remote conditions detected (codify legitimate exception explicitly).
- **(b)** General principle: require subagent halt-and-ask when its task requires overriding an operator guardrail. Preserves operator agency; slows pipeline marginally.

**Recommendation: (a) for force-push specific case + (b) as general principle for all subagent-overrides-guardrail patterns.** The pattern is now 2-sighting; promotion to P0 if 3rd sighting fires in next bundle.

- Edit `.claude/skills/bad/SKILL.md` subagent-dispatch preamble: "When a guardrail in your prompt conflicts with what your task requires, HALT and surface to coordinator. Do NOT override based on own reasoning."
- Edit `.claude/skills/bad/references/subagents/step6-pr-ci.md`: add explicit force-push-allowed-when-orphan-remote-detected clause.
- Net line-budget impact must be ≤0.
- Owner: Pedro.

**Q5 — bad-review Phase 2 4-subagent dispatch fix**

3rd sighting confirmed: PR #84 (inherited Opus), PR #85 (Agent-tool unavailable), PR #87 (full tool-trace inspection — zero Task/Agent calls inside bad-review audit subagent). The audits remain thorough as single-voice Opus deep-dives but the four-way-independence-via-fresh-context property is silently lost on every run. Memory captured at `feedback_nested_subagent_dispatch_limit`.

Root cause: bad-review's audit subagent (spawned by `/bad-review` or BAD Phase 4 R-mode) cannot spawn its own Agent/Task calls — parent BAD coordinator doesn't pass the Agent tool through. Memory says: "skills with parallel subagent spawn must run at top-level, not nested via BAD."

Two paths:
- **(a)** Fix dispatch — verify Agent tool is in the bad-review subagent's allowed tool list; pass it explicitly via dispatch parameters.
- **(b)** Acknowledge fallback — add explicit fallback note in `bad-review/SKILL.md` Phase 2 that says "if Agent tool unavailable, run all 4 prompt files inline with 4 separate Read-then-analyze passes, clearing context between each via explicit recap." Failure mode becomes visible in audit output.

**Recommendation: (b)** per the memory's established guidance — `/bad-review` must run at top-level (fresh session), not nested via BAD. Document this constraint in bad-review/SKILL.md AND in bad/SKILL.md Phase 4 R-mode prompt: "[R] inline bad-review will lose four-way independence — recommend [S] standalone instead."

- Edit `.claude/skills/bad-review/SKILL.md` Phase 2: add explicit inline-fallback banner + warning.
- Edit `.claude/skills/bad/SKILL.md` Phase 4 R-mode: warn the user.
- Net line-budget: bad-review/SKILL.md 676/750 → ~684/750 (comfortable). bad/SKILL.md 980/1000 → ≤980 (compress to neutral).
- Owner: Pedro.

**Path (c) — future architectural cleanup, not next-bundle blocker.** The deeper fix is to restructure BAD Phase 4 R-mode so the BAD coordinator dispatches the 4 audit subagents DIRECTLY (eliminate the nested audit-subagent intermediary that's causing the Agent-tool-unavailable failure mode). This removes the constraint at its root rather than documenting around it. Path (b) is right for next bundle; path (c) is the work that prevents re-deriving this same insight at the next retro. Surface for promotion when (1) Phase 4 R-mode is being touched anyway for other reasons, or (2) a future bundle's bad-review fidelity would benefit enough to justify the refactor cost.

**Q6 — bad-review Q5 MCP gate per-subagent re-check OR banner-on-stale**

2nd sighting of Q5 (Epic 6 retro) gate insufficient. PR #87 audit (2026-05-11): Q5 pre-check passed (8 non-auth tools detected) but token EXPIRED mid-Phase-2; subagents silently fell back to training-data claims without the "⚠ Mirakl MCP unavailable" banner. Manual disclaimer was added post-hoc by Pedro. Same failure mode as Story 6.1 dispatch (1st sighting).

Two paths:
- **(a)** Per-subagent MCP re-check — each Phase 2 subagent verifies token liveness before any Mirakl-relevant claim; emits banner on failure. More accurate, more tokens.
- **(b)** Banner-on-stale — subagents must emit "⚠ Mirakl MCP unavailable" banner if they make any Mirakl claim without successfully invoking an MCP tool this turn. Cheaper, slightly weaker guarantee.

**Recommendation: (b)** first; promote to (a) only if 3rd sighting fires.

- Edit each `.claude/skills/bad-review/references/subagents/*.md` prompt: require banner on every Mirakl claim not backed by an MCP tool call this turn.
- Net line-budget: bad-review/SKILL.md negligible (per-subagent files separately tracked).
- Owner: Pedro.

**Q7 — Bundle-C-cleanup chore PR**

Bundle 7 small follow-ups that are too small for individual stories but should ship before Bundle C participants' code grows further dependencies:

1. Narrow `pri02-poller.js` lazy `import('./pri03-parser.js')` catch from bare to `err.code === 'ERR_MODULE_NOT_FOUND'` (deferred-work line 377 + retroactive-application from Story 7.2 commit 983b8fb per line 402).
2. Add module-presence assertion for the 5 missing Bundle C modules in AC8 grep (deferred-work line 418: `advisory-lock`, `master-cron`, `pri02-poll`, `pri03-parser`, `dispatcher`).
3. Restructure AC2 staging INSERT assertion to have `assembleCycle` own the INSERT path, removing test-issued INSERT (deferred-work line 419).
4. Add N>1 batch atomicity sub-test for pending-import-id invariant test (deferred-work line 420).
5. Reconcile AC3 sub-test 5 spec wording (parser invocation) with implementation (audit_log INSERT count under `hasErrorReport: false`) — spec amendment OR implementation update (deferred-work line 421).
6. Reconcile AC4 spec wording vs `transitionCronStateFn` injection signature (deferred-work line 422).
7. Migrate Story 7.2 + 7.3 unit tests to use `fixture._expected` as oracle (mirroring AC1 pattern) OR update their hardcoded values to match. 5 sub-tests across 3 named groups (deferred-work line 424).
8. Test gap: regression test for narrowed-catch behavior on `decide.js` — assert non-`ERR_MODULE_NOT_FOUND` error from dynamic import surfaces (deferred-work line 403).
9. Test gap: three-strike re-fire suppression behavioral test (deferred-work line 378).

- Owner: Pedro (or a /bad dispatch of a single "Bundle-C-cleanup" story whose scope is all 9 follow-ups).
- Why: each item is small but they're related (Bundle C joint-correctness tightening) and should ship together to keep the test surface coherent.
- Timing: before Story 7.4 (anomaly-freeze) ships, because the cleanup PR also amends `p11-cooperative-absorption-anomaly-freeze.json` fixture to track the eventual `_expected.auditEvent: anomaly-freeze` flip (deferred-work line 417).

**Q8 — CI workflow integration-test gate — DECIDED (path a, two-phase rollout)**

`.github/workflows/ci.yml` only runs Lint + RLS Regression. The 45 Bundle C integration tests in `tests/integration/*.test.js` never run on GitHub CI. Currently the safety net is bad-review's Phase 1 step 5 CI-pending guard which runs `npm test` locally in the PR's worktree as authoritative — this is what protected us on PR #91 (audit subagent ran 45 integration tests locally, verified 45/45 pass before approving merge).

Gap is load-bearing now that Bundle C atomicity invariants depend on integration-test coverage. Future PRs touching engine/safety/Mirakl code that bypass `/bad` + `/bad-review` (e.g., manual `gh pr merge`) have NO integration-test enforcement.

**Decision (Pedro, 2026-05-13): Path (a) with two-phase rollout.**

- **Phase 1 (immediate)**: Add `node --test tests/integration/*.test.js` to `.github/workflows/ci.yml` as a required check. The 45 Bundle C integration tests pass cleanly — this gives a CI-enforced safety floor immediately without surfacing the unit-test drift.
- **Phase 2 (post-Q7 cleanup)**: After the Bundle-C-cleanup PR (Q7 item 7) migrates Story 7.2 + 7.3 unit tests to the `fixture._expected` oracle pattern (closing the 5 new fails), expand the CI check to full `npm test`. Pre-existing 23-fail set (W2) is pre-Go-Live stabilization scope and can be tolerated separately or scoped out via test-allowlist if blocking.

**Why two-phase**: full `npm test` today would block every PR on the 5 new fails (Story 7.2/7.3 `_expected` drift) AND the 23 pre-existing fails. Phase 1 scopes the check to the test surface that's actually green; Phase 2 expands once known fails are closed.

- Owner: Pedro (CI workflow edit immediately; Q7 cleanup PR migrates unit tests; Phase 2 follows).
- Closes deferred-work line 435.

**Q9 — Memory entry: `reference_synthetic_integrated_branch_recovery`**

Capture the pattern recipe before it gets re-derived from scratch on the next bundle topology failure:
1. Identify the linear chain (88% of Bundle C was already linear).
2. Merge each missing parallel-dispatch sibling in dependency order via `git merge --no-ff` (disjoint files → clean merge).
3. Verify all required modules present via `ls` checks.
4. Re-dispatch gate story forking from synthetic branch.
5. Post-merge cleanup: `git branch -D bundle-<X>-integrated`.

Validated this session on Bundle C: 7.3 merged cleanly into 7.6 (disjoint files), produced `bundle-c-integrated`, Story 7.8 re-dispatched from there, gate passed.

- Owner: write memory entry now (this retro).

### Strongly recommended bundling note

Q3 + Q4 + Q5 all touch `bad/SKILL.md`. Currently 980/1000 = 98% threshold. The 3 patches combined would add ~10-15 lines if added without offset. Each patch must be net line-budget-neutral; compress redundant prose to make room.

---

## §6. Watch Items

**W1 — Bundle dispatch enforcement on next bundle**
- After Q1 ships, the next bundle (Bundle D candidate: Story 12.1, or Stories 11.5+10.3) is the first verification under live dispatch.
- Watch trigger: if Q1 enforcement HALTS a legitimate dispatch (false-positive), or if a parallel-dispatch slips through (false-negative), surface at next retro.
- Owner: Pedro.

**W2 — 28/546 unit-test fails on main post-Bundle-C**
- 23 pre-existing fails (predate Bundle C — `dashboard-dry-run-minimal` 500, `margin-question` 15/17, scan.js `no-direct-fetch` lint, cron-state.test.js from PR #71); 5 new Bundle-C-introduced fails (Story 7.2/7.3 unit tests with stale hardcoded `_expected` values).
- Q7 cleanup PR closes the 5 new fails. The 23 pre-existing fails are pre-Go-Live stabilization scope.
- Watch trigger: if pre-existing fail count grows past 30 OR new fail count exceeds Q7's closure, surface for halt-and-investigate.
- Owner: Pedro.

**W3 — Worten scan worker hardening (Epic 4 retro carry-forward, deferred-work lines 322-323)**
- Live smoke 2026-05-07 showed transient 5xx failures during paginated P11 fetch ("O Worten está temporariamente indisponível") + progress-counter overshoot ("12900 de 12898").
- Defer to Epic 7 / scan hardening or to a standalone chore PR before Go-Live.
- Watch trigger: any onboarding scan failure observed in dogfood testing (Gabriel project per `project_gabriel_dogfood_testbed` memory) — surfaces requirement immediately.
- Owner: Pedro.

**W4 — `scan.js` bare `fetch()` (deferred-work line 316)**
- `no-direct-fetch` lint flags it; pre-existing failure on main.
- Bundled into Q8 CI decision: if Q8 path (a) ships, this becomes a CI-blocking item and must close before next merge. If Q8 path (b), accept as decorative.
- Owner: Pedro.

**W5 — `pri01_staging_modify_own` RLS policy missing `USING` clause (deferred-work line 331)**
- Defense-in-depth gap; service-role writes bypass RLS today, but a follow-up RLS audit story should harden.
- Watch trigger: any RLS regression test failure on `pri01_staging` table OR pre-Go-Live RLS audit.
- Owner: Pedro.

**W6 — Anomaly-freeze production-code stub-fallback in `cooperative-absorb.js` (deferred-work line 416)**
- PR #91 audit Subagent C flagged as BLOCKING; coordinator downgraded based on Story 7.8 spec line 165 explicitly authorizing Story 7.4's absence. Per `feedback_bmad_sm_owns_spec_failures` memory — if structural deferral seems weak, Bob owns it via `/bmad-correct-course`.
- **Decision needed:** (a) tighten Story 7.4 spec to rewrite cooperative-absorb's freeze path before 7.4 ships, OR (b) accept as documented cross-story bridge until 7.4 lands.
- Coupled with: when Story 7.4 ships, the `p11-cooperative-absorption-anomaly-freeze.json` fixture MUST flip `_expected.auditEvent` from `null` to `'anomaly-freeze'` (deferred-work line 417). Add to Story 7.4's acceptance criteria.
- Owner: Bob (spec amendment for Story 7.4) + Pedro.

**W7 — Bypass-aware middleware in `margin.js` (deferred-work line 289)**
- Epic 4 carry-forward. Test-only escape hatch in production code.
- Watch trigger: pre-Go-Live security review.
- Owner: Pedro.

**W8 — `max_discount_pct` sentinel + key.js placeholder (deferred-work line 288)**
- Spec-vs-schema contradiction; `IS NOT NULL` guard is unreachable in production.
- Watch trigger: when Epic 8 dashboard work hits this guard OR when first real customer onboarding exposes the redirect-loop.
- F5 amendment territory if a 3rd customer-facing impact surfaces.
- Owner: Pedro.

---

## §7. Significant Discoveries

| Check | Result |
|---|---|
| Bundle C architecture proven wrong? | No — atomicity bundle worked as designed; the FAKE-GATE was a spec failure, not an architecture failure. |
| Engine + writer + poller + parser + safety integration proven wrong? | No — 45/45 integration tests against real modules verify joint correctness. |
| `/bmad-correct-course` workflow proven inadequate for spec-failure recovery? | No — twice-validated now (Stories 6.3 + 7.8). Pattern is canonical. |
| Mega-PR merge pattern proven wrong? | No — preserves atomicity better than cascade; default for future bundles. |
| BAD coordinator architecture proven wrong? | No — Q1+Q2+Q4 from Epic 5 retro held across 8 dispatches + 1 course-correction + 1 fake-gate recovery. |
| New BAD pipeline failure modes uncovered? | Yes — 4: bundle dispatch topology (Q1), Phase 5.5a migration application (Q2), PR body hallucination (Q3 — promoted from 4-sighting), subagent guardrail override (Q4 — 2-sighting). |
| New bad-review failure modes uncovered? | Yes — 2: Phase 2 self-analyze (Q5 — 3-sighting), MCP token mid-flight expiry (Q6 — 2-sighting). |
| CI workflow gap surfaced? | Yes — integration tests not GitHub-Actions-gated; bad-review local fallback is the current safety net (Q8 design decision). |

**Verdict: NO Bundle C architectural changes. NO PRD or Architecture distillate amendments required.** 9 sequenced action items (Q1+Q2 P0; Q3-Q9 strongly recommended or follow-up), 8 watch items, 1 design decision (Q8). All patches surgical edits to BAD/bad-review skill files. Net line-budget impact must remain ≤0 for `bad/SKILL.md` (currently 980/1000); ~7-10 lines headroom in `bad-review/SKILL.md` (676/750).

---

## §8. Bundle C Live-Smoke Verdict (W3 from Epic 5 + Epic 6 retros)

**Question**: Is the single-gate model at Story 7.8 sufficient for Bundle C correctness, OR should per-PR live smoke have run on PRs #81-#85 / #87-#89?

**Evidence**:
- 45/45 integration tests against real production modules caught the fake-gate (PR #90 → PR #91 recovery).
- Pre-merge per-PR live smoke would NOT have caught the fake-gate because the fake-gate's smoke would have passed against stubs.
- Per-PR live smoke would have added ~5 dispatch overheads × 8 PRs = ~40 manual smoke runs. Cost vs catch: zero net catches.

**Verdict**: Single-gate model at 7.8 is sufficient. Per-PR live smoke is NOT load-bearing for bundle dispatch.

**However**: the gate test itself MUST exercise real production modules (no stubs). SCP-2026-05-11 Amendment 7 + AC8 close this. Future bundle gates must replicate the no-stub-fallback discipline.

W3 closes ✅.

---

## §9. Readiness Assessment

| Area | Status | Notes |
|---|---|---|
| Bundle C stories shipped through pipeline + merged to main | ✅ 8/8 | PR #91 mega-merge; all participant code on main as squash 89b2378 |
| Bundle C joint correctness | ✅ Verified | 45/45 integration tests against real modules |
| BAD coordinator integrity | ✅ Held | Epic 5/6 retro patches held throughout |
| `/bmad-correct-course` recovery tool | ✅ Twice-validated | Stories 6.3 + 7.8 |
| Bundle dispatch topology rule | ⚠️ Pending Q1 codification | Q1 P0 required before next bundle dispatch |
| Phase 5.5a migration application check | ⚠️ Pending Q2 | Q2 P0 required to close migration silent-degrade failure mode |
| PR body decorative-data discipline | ⚠️ Pending Q3 | 4-sighting threshold reached |
| Subagent guardrail-override discipline | ⚠️ Pending Q4 | 2-sighting threshold (3rd sighting promotes to P0) |
| bad-review four-way independence | ⚠️ Pending Q5 | 3-sighting; inline-fallback documented |
| bad-review MCP mid-flight resilience | ⚠️ Pending Q6 | 2-sighting; banner-on-stale documented |
| Bundle-C-cleanup chore PR (Q7) | ⏳ Pending Q7 dispatch | 9 follow-ups bundled; ships before Story 7.4 |
| CI workflow integration-test gate | ⏳ Pending Q8 decision | Design choice: GitHub Actions enforcement vs bad-review local fallback |
| Synthetic integrated-branch recovery memory | ⏳ Pending Q9 | Memory entry to write at this retro |
| PRs #81-#85, #87-#89 close-as-superseded | ⏳ Pending operational cleanup | Per SCP-2026-05-11 §6 step 5; not a retro action |
| `bundle-c-integrated` synthetic branch deletion | ⏳ Pending operational cleanup | Per SCP-2026-05-11 §6 step 5 |
| 8 prior worktrees cleanup | ⏳ Pending operational cleanup | Per SCP-2026-05-11 §6 step 5 |
| Epic 7 stories 7.4 / 7.5 / 7.7 | ⏳ Backlog | Sharded when Bob dispatches; Story 7.4 has W6 + fixture-flip preconditions |
| Epic 7 retrospective | ⏳ Deferred | Fires when all Epic 7 stories done |
| Context budget | ✅ Within threshold | TOTAL 34.6k tokens; Q1+Q2+Q3+Q4 patches must compress for neutrality |
| Sprint-status: epic-5 + epic-6 | ⏳ Proposed flip | in-progress → done at §11 below |
| Sprint-status: 5.1/5.2/6.1/6.2/6.3/7.2/7.3/7.6 | ⏳ Proposed flip | review → done (PR #91 mega-merge supersedes) |
| Sprint-status: epic-5-retrospective + epic-6-retrospective | ⏳ Proposed flip | optional → done |

---

## §10. Key Takeaways

1. **Bundle dispatch topology must be linear.** Parallel-dispatch within a bundle authorized the fake-gate via missing-module stub-fallback. Codify via `bundle_dispatch_orders:` (Q1). The root cause is mechanical — a structural enforcement at Phase 0 is cheaper than another spec-amendment recovery saga.

2. **`/bmad-correct-course` + synthetic integrated-branch + mega-PR is the canonical bundle-recovery recipe.** Twice-validated. When a bundle's atomicity-gate story forks from the wrong base, don't unwind the bundle. Build a synthetic integrated branch via `git merge --no-ff` of missing parallel-dispatch siblings, re-dispatch the gate, then merge as a single mega-PR. Memory: `feedback_correct_course_validated_for_spec_failures` + new `reference_synthetic_integrated_branch_recovery`.

3. **SM owns spec failures.** When dev follows broken spec correctly, the spec is the failure — Bob owns recovery via `/bmad-correct-course`. Memory: `feedback_bmad_sm_owns_spec_failures`. This shifts blame allocation from "dev didn't catch it" to "spec authorized it." Pattern surfaced on Story 7.8 (Bundle C gate); validated retroactively against Story 6.3 wire-up gap.

4. **Phase 5.5a doesn't verify migration application to remote.** Bundle C's 4 migrations sat local-only for ~12h until manual `db push --include-all`. Q2 extension catches this structurally. The Supabase CLI's out-of-order-timestamp gotcha (memory: `reference_supabase_migration_push_gotchas`) is operationally relevant for any story whose migration timestamps shift across rebases.

5. **Subagent overrides operator guardrails twice now.** Fake-gate rationalization + force-push deviation. Both technically defensible; both lost operator agency. Q4 adds halt-and-ask discipline. 3rd sighting promotes to P0.

6. **bad-review Phase 2 self-analyze is 3-sighting confirmed.** The four-way fresh-context independence property is silently lost when bad-review runs nested via BAD. Memory: `feedback_nested_subagent_dispatch_limit`. Run `/bad-review` at top-level (fresh session), not via BAD Phase 4 R-mode.

7. **PR body hallucination is 4-sighting confirmed.** Remove the "Files Changed" line entirely (Q3 path b) — GitHub already displays this verbatim from git. Stop trying to constrain a reliably-failing decorative generation; just remove the failure surface.

8. **Mega-PR preserves atomicity better than cascade.** PR #91 ships 8 stories as a single squash commit. Cascade-merge would have unwound `merge_blocks` piece-by-piece; any mid-cascade rollback would have left main in a partial state. Default to mega-PR for future bundles.

9. **The 7.8 gate IS load-bearing for Bundle C correctness; per-PR live smoke is not.** Single-gate model at 7.8 is sufficient — provided the gate test exercises real production modules (no stubs). SCP-2026-05-11 Amendment 7 + AC8 codify the no-stub discipline.

10. **Q1+Q2+Q4 patches from Epic 5 retro held cleanly across 8 dispatches + 1 course-correction + 1 fake-gate recovery.** Sticky upstream patches reliably reduce manual recovery work. The pattern of "one retro = one batch of upstream patches that land before the next dispatch" is working — keep it.

---

## §11. Sprint-Status Updates (proposed)

Bundle C participants flip to `done` — their code is on main via PR #91 mega-merge (squash 89b2378):

| Key | Current | Proposed | Justification |
|---|---|---|---|
| `5-1-master-cron-dispatcher-sql-...` | review | done | PR #91 mega-merge supersedes PR #81 |
| `5-2-pri01-staging-schema-cycle-assembly-skeleton` | review | done | PR #91 supersedes PR #82 |
| `6-1-shared-mirakl-pri01-writer-js-...` | review | done | PR #91 supersedes PR #83 |
| `6-2-shared-mirakl-pri02-poller-js-...` | review | done | PR #91 supersedes PR #84 |
| `6-3-shared-mirakl-pri03-parser-js-...` | review | done | PR #91 supersedes PR #85 |
| `7-2-worker-src-engine-decide-js-...` | review | done | PR #91 supersedes PR #87 |
| `7-3-worker-src-engine-cooperative-absorb-js-...` | review | done | PR #91 supersedes PR #88 |
| `7-6-worker-src-safety-circuit-breaker-js-...` | review | done | PR #91 supersedes PR #89 |
| `epic-5` | in-progress | done | All 2 stories done |
| `epic-6` | in-progress | done | All 3 stories done |
| `epic-5-retrospective` | optional | done | Bundle C close-out logged here |
| `epic-6-retrospective` | optional | done | Bundle C close-out logged here |

Total: 12 sprint-status flips.

**PRs to close-as-superseded post-merge (operational cleanup, NOT retro action):**
- #81, #82, #83, #84, #85, #87, #88, #89 — close with comment referencing PR #91 mega-merge.
- `git branch -D bundle-c-integrated` once close-as-superseded operations complete.
- 8 prior worktrees cleanup (per SCP-2026-05-11 §6 step 5).

---

## §12. Next Steps (ordered by session)

Story 7.4 is **3 sessions away**, not the next `/bad` invocation. The retro outcomes split cleanly into 3 sessions:

### Session 1 — Inline skill patches + CI Phase 1 + operational cleanup (this session or next)

1. **Q9 (already done)**: `reference_synthetic_integrated_branch_recovery` memory entry written this retro.
2. **Q1 (P0)**: Codify `bundle_dispatch_orders:` block in `sprint-status.yaml` + Phase 0 enforcement in `bad/SKILL.md`. Required before next bundle dispatch.
3. **Q2 (P0)**: Phase 5.5a migration-application check — `npx supabase migration list` parsing + HALT on Local-but-not-Remote in `bad/SKILL.md`.
4. **Q3**: Remove "Files Changed" line from `step6-pr-ci.md` template.
5. **Q4**: Subagent guardrail-override discipline — coordinator preamble in `bad/SKILL.md` + Step 6 force-push exception codification in `step6-pr-ci.md`.
6. **Q5 (path b)**: bad-review Phase 2 inline-fallback banner in `bad-review/SKILL.md` + `/bad-review`-top-level warning in `bad/SKILL.md` Phase 4 R-mode. Path (c) deferred (future architectural cleanup).
7. **Q6**: bad-review banner-on-stale MCP — per-subagent prompt edits in `bad-review/references/subagents/*.md`.
8. **Q8 Phase 1**: Add `node --test tests/integration/*.test.js` to `.github/workflows/ci.yml` as a required check.
9. **Operational cleanup**: close PRs #81-#85, #87-#89 as superseded (referencing PR #91); `git branch -D bundle-c-integrated`; clean 8 prior worktrees.

**Budget constraint**: Q1+Q2+Q3+Q4+Q5 all touch `bad/SKILL.md` (980/1000). Each patch must be net line-budget-neutral; sequence the compression alongside the additions. `bad-review/SKILL.md` (676/750) has headroom for Q5+Q6.

### Session 2 — Bundle-C-cleanup chore PR via /bad (own session)

10. **Q7 cleanup PR**: 9 small follow-ups bundled (see §5 Q7 for the full list — narrowed-catch retroactive, AC8 missing modules, AC2 staging INSERT circularity, AC3+AC4 spec/impl reconciliation, Story 7.2 + 7.3 unit-test `_expected` oracle migration, 3-strike re-fire suppression test, decide.js narrowed-catch regression test). Sharded as a single story, dispatched via `/bad`.

### Session 3 — Story 7.4 (anomaly-freeze) via /bad (own session)

11. **Bob shards Story 7.4** — preconditions: Q1 + Q2 landed (Session 1) AND Q7 cleanup PR merged (Session 2). Story 7.4 must include: AC update flipping `p11-cooperative-absorption-anomaly-freeze.json` fixture's `_expected.auditEvent` from `null` to `'anomaly-freeze'`, plus the W6 decision on cooperative-absorb's freeze-path stub.
12. **Q8 Phase 2**: Once Session 2's Q7 cleanup PR closes the 5 Bundle-C-introduced unit-test fails, expand `.github/workflows/ci.yml` from integration-tests-only to full `npm test`. Decide separately whether to scope-out the 23 pre-existing fails via test-allowlist or absorb them into a pre-Go-Live stabilization pass.

### After Stories 7.4 + 7.5 + 7.7 all complete

13. **Epic 7 retrospective** — fires.

---

**Bundle C close-out retrospective complete.** Production-correctness verdict: ✅. Joint-correctness verdict: ✅. Mega-merge atomicity preserved. 9 action items + 8 watch items + 1 design decision logged. Document saved at `_bmad-output/implementation-artifacts/bundle-c-close-out-retro-2026-05-13.md`. Sprint-status flips proposed at §11; apply pending Pedro confirmation.
