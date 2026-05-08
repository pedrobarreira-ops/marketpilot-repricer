# Epic 5 Retrospective — BAD Pipeline (scoped, partial)

**Date**: 2026-05-08
**Facilitator**: Bob (`bmad-retrospective`)
**Project Lead**: Pedro
**Scope**: BAD pipeline learnings only. Bundle C is open (PRs #81 + #82 awaiting Story 7.8 atomicity gate); production-correctness and live-smoke findings are deferred to a separate Bundle C retrospective after 7.8 merges.
**Stories Reviewed**: 5.1 (review, PR #81 OPEN), 5.2 (done, PR #82 OPEN — merge-blocked by Bundle C gate)
**Context-budget audit**: ✅ clean — `node scripts/context-budget.js` reports all files within threshold (TOTAL 34.6k tokens per BAD subagent spawn; `bad/SKILL.md` near at 988/1000)
**Sprint-status update**: `epic-5: in-progress` (UNCHANGED — Bundle C still open); `epic-5-retrospective: optional` (UNCHANGED — Bundle C retro pending). This scoped retro is logged but does NOT close the epic-5-retrospective key.

---

## Why a scoped retro now

Two BAD pipeline regressions surfaced during the Story 5.2 run (the first-ever stacked-worktree dispatch via the new atomicity-bundle exception). A third — bad-review Live Smoke false-positive — fires on every remaining Bundle C PR. All three need patches before Bob shards Story 6.1, otherwise each Bundle C participant pays the same recovery cost. Production-correctness verdict on the dispatcher SQL, advisory-lock determinism, and `pri01_staging` schema is held back to the Bundle C retro where the 7.8 gate test gives the joint correctness signal.

---

## (a) The 3 BAD pipeline bugs in deferred-work

### Bug 1 — Step 3 dev subagent writes sprint-status + leaves worktree dirty

**Source:** `deferred-work.md:329`

**Symptom:** Story 5.2 Step 3 advanced `sprint-status.yaml` from `atdd-done` → `review` directly on the main-repo file (with a 74-line prepended comment block) AND left 3 implementation files uncommitted in the worktree (`worker/src/cycle-assembly.js`, `supabase/migrations/202604301214_create_pri01_staging.sql`, `scripts/rls-regression-suite.js`).

**Caught by:** BAD's hash-snapshot gate (sprint-status mutation) + uncommitted-files gate. A recovery subagent committed the worktree files and reverted the main-repo sprint-status change.

**Root cause:** Vendored `_bmad/bmm/4-implementation/bmad-dev-story/workflow.md` step 9 still instructs the dev-story agent to flip sprint-status to `review`. The wrapper instruction at the top of `step3-develop.md` (lines 61-65) telling it to ignore that — was ignored.

**Recurring:** This is the BAD coordinator vs. dev-story-vendor authority conflict. Wrapper-level "ignore this instruction" prose hasn't reliably overridden the vendored workflow.

**Fix (recommended — Q1):** Have the BAD coordinator **back up the sprint-status file** (file-copy to a temp path, NOT `git stash` — git stash would conflict with Step 3's uncommitted-files gate that fires immediately after) before Step 3 dispatch and **restore** it after if mutated. Defeats subagent modification mechanically; no longer relies on the subagent reading the wrapper correctly. Cost: ~6 lines of coordinator code (Step 3 spawn ± copy/hash-check/restore wrapper). Risk: backup-path collision if two parallel dispatches run simultaneously — mitigated by per-story backup filename (e.g., `/tmp/sprint-status-step3-backup-{story}.yaml`).

### Bug 2 — Step 6 PR & CI uses Monitor instead of local-CI fallback when `RUN_CI_LOCALLY=true`

**Source:** `deferred-work.md:330`

**Symptom:** Story 5.2 Step 6 created PR #82 successfully then started a Monitor for GitHub Actions checks. Because `RUN_CI_LOCALLY=true` is set in `_bmad/config.yaml`, GitHub Actions does not run; Monitor hung with no checks reported. A recovery subagent had to run `npm run lint` + `npm run test:rls` manually (both passed).

**Recurring:** Will fire on every PR until patched. Story 5.1's PR #81 had the same hang (commit `9b7bbe7` "use test:unit in dev loop and post-merge verify" addresses adjacent perf, not the Monitor branch).

**Fix (recommended — Q2):** Edit `step6-pr-ci.md` (or its prompt template in `bad/SKILL.md`) to branch on `RUN_CI_LOCALLY` BEFORE dispatching Monitor — when true, skip Monitor entirely and run `npm run lint` + `npm run test:rls` (or `npm run test:unit` per `9b7bbe7`'s perf direction) directly inside Step 6. Cost: small prompt-template edit + condition logic.

### Bug 3 — bad-review Live Smoke guard false-positives on stacked PRs via inherited diffs

**Source:** `deferred-work.md:331`

**Symptom:** PR #82 (Story 5.2) stacked on PR #81's branch via the atomicity-bundle exception (`fa6f2be`). 5.2 itself touches zero Mirakl paths; the PR diff-vs-`main` includes 5.1's `worker/src/jobs/master-cron.js`. bad-review's Live Smoke guard matches `worker/src/jobs/` and demands a `[Skip-Live-Smoke:]` marker. Workaround applied: explicit skip marker referencing PR #81.

**Recurring — guaranteed:** Will fire on every remaining Bundle C PR (6.1 → 7.6). Each successive PR inherits progressively more upstream worker/Mirakl-touching files. By the time PR #87 (Story 7.6) opens, the diff-vs-`main` will include the entire engine + writer chain.

**Fix (CORRECTED post-trace — Q3):** Original draft proposed `git merge-base origin/main HEAD` as the diff baseline. **This was mis-traced and is a no-op for stacked PRs:** `merge-base(origin/main, HEAD)` returns the original fork point on main (commit M), not story-5.1's branch tip. `git diff M HEAD --name-only` returns the same set as `gh pr diff #82 --name-only` (both use 3-dot semantics against `main`).

The actual fix that resolves the false-positive requires diffing against the **upstream sibling's branch tip**, not `origin/main`. Two viable mechanisms:

- **Option C (git-topology discovery):** Enumerate `origin/story-*` refs except own; test each with `git merge-base --is-ancestor <branch> HEAD`; among ancestors, pick the one with the deepest merge-base (closest to HEAD). Fall back to `origin/main` if no ancestor branches found (non-stacked case). ~10 lines shell + sibling-disambiguation. Self-discovers stacked relationships from git itself; no new metadata. Adds ~50-80 tokens to `bad-review/SKILL.md` (currently 668/750 — eats 60-90% of remaining headroom).

- **Option A (merge_blocks `stacked_on:` field):** Add explicit field; read at Phase 0 dispatch and at bad-review run. Spec-mechanism creep; Phase 0's runtime decision is the source of truth and Option C reconstructs it from git for free. Not recommended.

**Decision: Option B (deferred, no patch).** The `[Skip-Live-Smoke:]` marker is a documented working workaround already applied on PR #82. Bundle C has 5 remaining PRs = 5 manual markers (bounded, low cost). Promote to Option C only if (a) a future bundle after C reuses stacked dispatch, OR (b) Bundle C completes with markers and stacking continues to be the bundle dispatch model. Until then, the marker is the standing workaround. See Action Items Q3 (demoted to standing-workaround note) and watch item W4.

---

## (b) Bundle-dispatch validation

The atomicity-bundle exception (`fa6f2be feat(bad): atomicity-bundle dispatch exception with stacked worktrees`) is the first time BAD has run a story off a non-`main` base branch. Below is what worked, what didn't, and what the next Bundle C participant inherits.

| Mechanism | Verdict | Evidence |
|---|---|---|
| `merge_blocks` correctly held PR #81 + #82 from auto-merging | ✅ Held | Both PRs OPEN as of 2026-05-08; merge would have left main in unverified state |
| Atomicity-bundle exception forks 5.2 worktree from 5.1's branch | ✅ Held | Per `bad/SKILL.md:367-380` Step 1 base_branch substitution; PR #82 head is `story-5.2-…` rebased on 5.1's branch |
| Phase 0 detects review-shipped bundle stories and excludes from re-selection | ✅ Held — after fix | `02e07c7 fix(bad): exclude review-shipped bundle stories from Ready re-selection` patched mid-batch (Pass 12 in commit log) |
| Phase 0 reads `merge_blocks` and recomputes Ready cells | ✅ Held — after fix | `d5d1a43 fix(bad): force Phase 0 to recompute Ready cells and read merge_blocks` patched mid-batch |
| Sprint-status push race on Story 5.1 done→review rollback | ⚠️ Caught and corrected | `fe95a9d` rolled back local `done` flip when PR #81 didn't actually merge — sprint-status got ahead of GitHub state |
| Phase 0 reconciliation passes during Epic 5 batch | ⚠️ 12 passes | High churn — passes 6-12 visible in commits. Three required code patches (`02e07c7`, `d5d1a43`, `fa6f2be`). |

**Verdict:** The atomicity-bundle exception works AS DESIGNED, but its first run cost three mid-batch coordinator patches and a sprint-status rollback. Bundle C still has 5 more participants to dispatch (6.1, 6.2, 6.3, 7.2, 7.3, 7.6 + the 7.8 gate). The patches are now sticky in main — subsequent participants should see fewer reconciliation passes.

**Sprint-status push race (Q4):** A new failure mode. Sprint-status flipped `done` locally on commit `66b947a` then was rolled back to `review` on `fe95a9d` after Phase 0 noticed PR #81 was still OPEN. The coordinator's "flip to done on Step 7 success" path doesn't gate on PR-merge-confirmation; it gated on Step 7 subagent reporting success, which can lie or run before merge actually completes on GitHub. Recommend: gate the `done` flip on `gh pr view <N> --json mergedAt` returning a non-null value, not on Step 7's exit status alone.

---

## (c) Step 5 timing on stacked PRs

**Concern:** Step 5 (Code Review, `MODEL_QUALITY`) runs `git -C {worktree_path} diff main --name-only` for the Worker/Critical-Path Opus Gate (`bad/SKILL.md:456-473`). For stacked PRs, this diff includes the upstream sibling's commits.

| Aspect | Verdict | Notes |
|---|---|---|
| Opus gate fires correctly on stacked PR | ✅ Held — by accident | For Story 5.2: 5.1's `worker/src/dispatcher.js` + `worker/src/advisory-lock.js` + `worker/src/jobs/master-cron.js` AND 5.2's own `worker/src/cycle-assembly.js` both match `worker/src/`. Gate fires; Opus is required. Correct outcome, wrong reason — would fire even if 5.2 contributed zero worker code. |
| Step 5 reviews include upstream code as if new | ⚠️ Pollution risk | Reviewer sees ~3 worker files from 5.1 alongside 5.2's contribution. Either re-reviews already-cleared code (token waste) or assumes upstream is fine and under-scrutinizes new diff (correctness risk). Empirically: Step 5 on PR #82 didn't surface duplicate findings vs PR #81's review, suggesting it's defaulting to "ignore upstream" — but this is implicit, not enforced. |
| Same diff-vs-`main` issue as bad-review Live Smoke | ⚠️ Same root cause | Both Step 5 (BAD) and Phase 1 step 7 (bad-review) compute paths via `git diff main --name-only`. Fixing Q3 (merge-base diff) for bad-review should be lifted to a shared helper and reused at Step 5. |
| Worker/Critical-Path Opus Gate would HALT if MODEL_QUALITY downgraded | ⚠️ Latent issue | If Pedro ever sets `MODEL_QUALITY=sonnet`, the gate would HALT every Bundle C PR even when the story itself is non-critical-path — because inherited diffs always match the path list. |

**Fix (deferred to watch item W2 — see Action Items):** Empirically Step 5 on PR #82 did not surface duplicate findings vs PR #81's review — implicit "ignore upstream" worked. No evidence the current behavior is broken; refactoring to a shared merge-base helper is structural cleanup, not a fix for observed harm. Trigger for promotion to action item: any Bundle C Step 5 surfaces a finding that's a duplicate of an upstream PR's already-resolved finding.

---

## Context-budget audit (CLAUDE.md mandatory)

```
File                                                                    Lines   Tokens  Threshold  Status
.claude/skills/bad/SKILL.md                                               988    11856       1000  near
.claude/skills/bad-review/SKILL.md                                        668     8016        750  ok
project-context.md                                                        583     6996        600  near
CLAUDE.md                                                                  81      972        100  ok
_bmad-output/planning-artifacts/architecture-distillate/_index.md         111     1332        150  ok
_bmad-output/planning-artifacts/epics-distillate/_index.md                452     5424        500  near
TOTAL                                                                    2883    34596

✓ All files within threshold. No compression needed.
```

**Watch items (none breach):** `bad/SKILL.md` (988/1000 = 98.8%), `project-context.md` (583/600 = 97.2%), `epics-distillate/_index.md` (452/500 = 90.4%) all sitting in the "near" band. Q1+Q2+Q4 patches will add ~15 lines / ~75 tokens to `bad/SKILL.md`, pushing it from 988 → ~1063 (over threshold) if added without offset. **Mitigation: each patch is responsible for its own line-budget neutrality.** When adding new logic, the same PR must remove ≥equivalent tokens of redundant prose from the same file. This makes the budget constraint mechanical at PR time and avoids deferring to a separate compression item.

---

## Action Items

### P0 — Blocking next Bundle C participant (Story 6.1)

**Q1 — Step 3 sprint-status file-backup/restore in coordinator**
- Edit `bad/SKILL.md` Step 3 spawn block: before subagent spawn, **file-copy** (NOT `git stash` — would conflict with the worktree's uncommitted-files gate immediately after Step 3) `_bmad-output/implementation-artifacts/sprint-status.yaml` to `/tmp/sprint-status-step3-backup-{story}.yaml`; after subagent returns (success or fail), hash-compare; if mutated, restore from backup, log the violation, and surface a halt-or-continue decision point. Per-story backup filename avoids collision under parallel dispatch.
- Net line-budget impact must be ≤0: when adding ~6 lines of stash/restore logic, remove ≥equivalent tokens of redundant prose from the same file (`bad/SKILL.md` is at 988/1000).
- Owner: Pedro (BAD upstream patch, single-PR change).
- Why: dev-story vendor instructions still tell the subagent to flip sprint-status; wrapper-level prose hasn't reliably overridden. Mechanical file-backup defeats the modification regardless of which prompt the subagent follows.

**Q2 — Step 6 `RUN_CI_LOCALLY` branch**
- Edit `step6-pr-ci.md` (or its inline coordinator prompt): read `_bmad/config.yaml:RUN_CI_LOCALLY`. If true → skip Monitor entirely, run `npm run lint` + `npm run test:unit` (or `npm run test:rls` for stories tagged `integration_test_required`) directly. If false → preserve current Monitor behavior.
- Net line-budget impact must be ≤0: ~5 lines added; remove ≥equivalent tokens from the same file.
- Owner: Pedro (BAD upstream patch, prompt edit).
- Why: every PR opened under local-CI mode hangs Monitor. Recovery is manual every time.

**Q3 — DEMOTED post-trace correction.** Original draft proposed `git merge-base origin/main HEAD` as the diff baseline; trace verification showed this is a no-op for stacked PRs (merge-base(origin/main, HEAD) = original fork point on main, not upstream sibling's tip). The fix that actually resolves the false-positive requires git-topology discovery of the upstream sibling (Option C in the bug-3 analysis above) — ~10 lines shell + sibling-disambiguation logic, not a one-liner.

**Decision:** Accept the `[Skip-Live-Smoke:]` marker as the standing workaround. Pre-applied on PR #82 with a reference to the upstream PR. Bundle C has 5 remaining PRs (#83-#87) — each needs a marker referencing its immediate upstream sibling. Bounded cost; well-documented pattern. No patch lands at this retro. See watch item W4 for promotion trigger.

### Strongly recommended pre-Story 6.1

**Q4 — Coordinator gates `done` flip on actual PR merge**
- Edit BAD's "Coordinator-Side Sprint-Status Flips" path (`bad/SKILL.md:359-365`): before flipping `review` → `done`, run `gh pr view <N> --json mergedAt --jq .mergedAt`. If null, do NOT flip; leave at `review` and emit a recovery message.
- Net line-budget impact must be ≤0: ~4 lines added; remove ≥equivalent tokens from the same file.
- Owner: Pedro (BAD upstream patch).
- Why: Story 5.1 sprint-status push-race showed Step 7's exit status is not equivalent to GitHub-confirmed-merge. Coordinator's authority on sprint-status requires authoritative state.

### Watch items

**Item W1 — Phase 0 reconciliation churn**
- Epic 5 batch ran 12 reconciliation passes with 3 mid-batch code patches. Bundle C has 6 more participants; expect churn to drop now that `02e07c7`, `d5d1a43`, `fa6f2be` are merged.
- Watch trigger: if Bundle C participants 6.1+ require ≥2 fresh mid-batch coordinator patches, hold dispatch and audit Phase 0 logic before continuing.
- Owner: Bob (Phase 0 reader integrity).

**Item W2 — Step 5 review-pollution from inherited diffs (subsumes deferred Q5)**
- Step 5 reviews on stacked PRs implicitly review upstream code. Has worked OK so far (no duplicate findings between PR #81 and PR #82 reviews) but is not enforced.
- Watch trigger: if any Bundle C Step 5 surfaces a finding that's a duplicate of an upstream PR's already-resolved finding → promote to action item: lift path-detection to a shared `getStoryPaths(worktree, baseBranch)` helper using merge-base; apply at BAD Step 5 Worker/Critical-Path Opus Gate (`bad/SKILL.md:456`) and bad-review Live Smoke. Until trigger fires, leave the structural cleanup deferred — empirical "ignore upstream" is working.
- Owner: Pedro.

**Item W3 — Mandatory pre-merge live smoke for Bundle C participants**
- Carry-forward from Epic 4 retro Item 5: live smoke is empirically load-bearing. Bundle C participants only run live smoke at the 7.8 gate; before that, they merge with no Mirakl-real verification.
- Watch trigger: at the Bundle C retro post-7.8, count live-smoke-caught bugs vs fixture-test-caught bugs to confirm the 7.8 single-gate model is sufficient (vs adding per-PR smoke).
- Owner: Bob (defer to Bundle C retro).

**Item W4 — bad-review Live Smoke false-positive on stacked PRs (Q3 deferred patch)**
- Standing workaround: `[Skip-Live-Smoke:]` marker on each Bundle C PR (#83-#87), referencing the immediate upstream sibling.
- Watch trigger 1 (immediate): if any Bundle C PR's marker workaround fails to satisfy the bad-review guard, surface here.
- Watch trigger 2 (post-Bundle C): if a future bundle after C reuses stacked dispatch as its model, ship Option C (git-topology upstream-sibling discovery) before that bundle dispatches.
- Watch trigger 3: if Pedro tires of the manual marker before either of the above fires, ship Option C opportunistically.
- Owner: Pedro (Option C ~10 lines shell + sibling-disambiguation; ~50-80 tokens added to `bad-review/SKILL.md`).

---

## Epic 4 Retro Action-Item Follow-Through (BAD-pipeline items only)

| Item | Description | Status | Evidence |
|---|---|---|---|
| 4 | BAD Step 5/7 `node --check` boot test | ⏳ Not yet shipped | No recurrence in Epic 5 (no route stories shipped — Stories 5.1/5.2 are worker-only). Defer status verdict to first Epic 5+ route-touching story. |
| 5 | Migration filename mechanical lint (`\d{12}_[a-z0-9_]+\.sql`) | ⏳ Not yet shipped | Story 5.2's `202604301214_create_pri01_staging.sql` is well-formed (12 digits, lowercase). No drift this epic; lint not yet authored. |
| 6 | Unit-test shadow-logic guardrail + npm test allowlist for `dry-run-minimal.test.js` | ⏳ Not yet shipped | Story 5.2 unit tests for `cycle-assembly.js` use real imports per Bob's shard. No new shadow-logic detected — but unenforced; first failure mode would be silent. |
| 8 | Step 6 PR-body hallucination — accept-and-monitor | ✅ No regression | PR #81 + #82 bodies are accurate per spot-check. 9-PR streak from Epic 4 broken — possibly due to fewer files changed per Bundle C participant. |
| 9 | Bundle C `merge_blocks` confirmation watch | ✅ Held — first concrete confirmation | Both PR #81 + #82 OPEN with `merge_blocks` keying off Story 7.8. No accidental merges. |

**Items 4-6 status:** Not blocking Epic 5 (no route stories shipped). Carry into Bundle C retro after Story 7.8 — the first opportunity to verify against route-touching code.

---

## Significant Discoveries — Result (BAD-pipeline scope only)

| Check | Result |
|---|---|
| BAD coordinator architecture proven wrong? | No — coordinator-owns-sprint-status authority is correct; Q1 mechanically enforces it |
| Stacked-worktree dispatch model proven wrong? | No — exception works; needs Q3 + Q5 path-detection patch for downstream tools |
| Step 5 / Step 6 / Step 7 fundamental redesign needed? | No — three local fixes (Q1 stash, Q2 RUN_CI_LOCALLY branch, Q3+Q5 merge-base diff) |
| New BAD pipeline failure modes uncovered? | Yes — 1 (sprint-status push race on Step 7 → done flip without GitHub-confirmed merge); resolved by Q4 |

**Verdict:** NO BAD pipeline architectural changes. 3 sequenced patches (Q1 + Q2 + Q4) before Bob shards Story 6.1. Q3 demoted post-trace correction (proposed one-liner was a no-op for stacked PRs; real fix requires git-topology discovery — deferred to watch item W4 with `[Skip-Live-Smoke:]` marker as standing workaround). Q5 deferred to watch item W2 (empirically Step 5 implicit "ignore upstream" works; promote only on observed harm). All three remaining patches are surgical edits to existing prompts. Each patch must be net line-budget-neutral (≤0 line delta in `bad/SKILL.md` — currently 988/1000).

**Production-correctness verdict for Stories 5.1 + 5.2 is held back to the Bundle C retrospective after Story 7.8 lands.** The atomicity-gate test at 7.8 is the joint correctness signal — assessing dispatcher SQL, advisory-lock determinism, `pri01_staging` schema, and engine integration in isolation before that gate fires would be premature.

---

## Readiness Assessment (BAD-pipeline scope only)

| Area | Status | Notes |
|---|---|---|
| Stories shipped through pipeline | ✅ 2/2 | 5.1 → review (PR #81 OPEN), 5.2 → done (PR #82 OPEN, merge-blocked) |
| BAD coordinator integrity | ⚠️ Open | Q1 + Q4 patches required before next Bundle C dispatch |
| BAD Step 6 (PR & CI) | ⚠️ Open | Q2 patch required — every PR currently hangs Monitor |
| bad-review Phase 1 step 7 (Live Smoke) | ⚠️ Manual workaround | Q3 demoted post-trace; `[Skip-Live-Smoke:]` marker pattern stands. 5 markers needed across PRs #83-#87. |
| Atomicity-bundle dispatch exception | ✅ Verified working | First run held under live conditions |
| `merge_blocks` enforcement | ✅ Verified working | Both Bundle C PRs correctly held from merge |
| Context budget | ✅ Within threshold | Watch `bad/SKILL.md` near 988/1000 — Q1+Q2+Q5 patches must compress |
| Production correctness of dispatcher / staging schema | ⏸️ Deferred | Bundle C retro post-7.8 |
| Live smoke (5.1 dispatcher; 5.2 staging) | ⏸️ Deferred | Bundle C retro post-7.8 |
| Sprint-status retrospective key | ⏸️ NOT flipped to done | `epic-5-retrospective: optional` (UNCHANGED) — second retro pending |

---

## Key Takeaways

1. **Coordinator-owned state needs mechanical, not prose, enforcement.** Wrapper prose telling the dev-story subagent to ignore vendored instructions failed. Stash/restore makes the override mechanical (Q1). Apply this pattern wherever coordinator state crosses into subagent territory.

2. **Stacked-worktree dispatch surfaces a class of "diff baseline" bugs.** Three places in the pipeline (BAD Step 5 Opus gate, bad-review Live Smoke, anywhere else doing path-list matching against `diff main`) all share the same wrong baseline. Fix once via shared helper using merge-base (Q3 + Q5).

3. **Sprint-status flips must gate on authoritative state, not subagent reports.** Step 7 reporting success ≠ PR merged. Q4 closes a previously-invisible failure mode that surfaced exactly once (Story 5.1 done→review rollback) and would re-fire on any merge with a delay between `gh pr merge` request and remote completion.

4. **Atomicity bundles compound coordinator complexity.** Bundle B (Epic 4) was 2 stories, ran cleanly. Bundle C (this Epic + Epic 6 + Epic 7) is 6 stories — and the first run already cost 3 mid-batch coordinator patches and 12 reconciliation passes. The next 5 participants benefit from those patches now being merged, but Bundle C should be the test bed for any future bundling decisions; bundles >6 stories likely need pipeline redesign rather than incremental patches.

5. **Phase 5/Phase 1-step-7 path detection bugs are equivalent.** Treat them as a single class. Q3 lands the merge-base computation; Q5 lifts it to a helper and applies it everywhere. This is structurally cleaner than patching each call site.

---

## Next Steps (ordered)

1. **Q1: Step 3 sprint-status file-backup/restore** — coordinator-side patch in `bad/SKILL.md` Step 3 spawn block. File-copy mechanism (NOT `git stash`). Net line-budget impact ≤0.
2. **Q2: Step 6 `RUN_CI_LOCALLY` branch** — `step6-pr-ci.md` prompt edit. Net line-budget impact ≤0.
3. **Q4: Coordinator gates `done` flip on `gh pr view --jq .mergedAt`** — `bad/SKILL.md` Step 7 success path. Net line-budget impact ≤0.
4. **Q3 — DEFERRED.** Standing workaround: `[Skip-Live-Smoke:]` marker on each Bundle C PR. Promote to Option C (git-topology upstream-sibling discovery, ~10 lines shell) only on watch-item W4 trigger.
5. **Bob shards Story 6.1** — only after Q1+Q2 land. Q4 strongly recommended; Q3 not patched at all. Story 6.1 inherits Bundle C `merge_blocks`, stacked-worktree dispatch, and the standing Skip-Live-Smoke marker pattern.
6. **Bundle C retrospective** — fires after Story 7.8 atomicity gate lands. Assesses joint correctness of dispatcher + staging + writer + engine + cooperative-absorption + circuit-breaker chain. Will close items deferred from this retro (live-smoke verdict, production-correctness verdict, Epic 4 retro Items 4/5/6 follow-through with route stories) and assess W2 + W4 trigger status.

---

**Scoped retrospective complete.** Sprint-status update: `epic-5-retrospective: optional` (UNCHANGED — Bundle C retro pending after Story 7.8); `epic-5: in-progress` (UNCHANGED). Document logged at `_bmad-output/implementation-artifacts/epic-5-retro-bad-pipeline-2026-05-08.md`.
