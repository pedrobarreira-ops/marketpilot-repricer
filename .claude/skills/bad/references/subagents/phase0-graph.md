# Phase 0: Dependency Graph — Detailed Reference

Read this file during Phase 0 steps 4 and 6.

---

## Step 4: Update GitHub PR/Issue Status and Reconcile sprint-status.yaml

GitHub PR merge status is the **authoritative source of truth** for whether a story is `done`. This step always runs, even on resume.

### PR Status Lookup

Search by branch name:
```bash
gh pr list --search "story-{number}" --state all --json number,title,state,mergedAt
```
If `gh` fails, read `references/coordinator/pattern-gh-curl-fallback.md` and use the `gh pr list` curl equivalent.

### GitHub Issue Number Lookup

Resolve in this order:
1. Check the epic file and `sprint-status.yaml` for an explicit issue reference.
2. If not found, search by the BMad issue title prefix `"Story {number}:"`:
   ```bash
   gh issue list --search "Story 3.1:" --json number,title,state
   ```
   If `gh` fails, use the `gh issue list` curl equivalent from `references/coordinator/pattern-gh-curl-fallback.md`.
   Pick the best match by comparing titles.
3. If still not found, leave the Issue column blank.

### Reconcile sprint-status.yaml from PR Status

After updating PR statuses, sync `_bmad-output/implementation-artifacts/sprint-status.yaml` at the **repo root** to match. GitHub is the authoritative source — overwrite the file to match it, regardless of what the file currently says.

**Story-row reconciliation (bidirectional):**
- For every story whose PR is **merged** on GitHub → set its sprint-status entry to `done`.
- For every story whose sprint-status shows `done` BUT whose PR is still `open` (or has no PR yet) → roll it back to `review` (if a PR exists) or `atdd-done`/`ready-for-dev` as appropriate. This catches the push-race pattern where BAD's Step 7 flipped the row to `done` on main but the PR hadn't actually merged yet — the flip gets stranded on local or preempts the merge commit. GitHub truth wins.

**Epic-row reconciliation:**
- For each epic that has an `epic-{N}:` row in sprint-status: if every story row under that epic is `done`, set the epic row to `done`. Otherwise leave it as `in-progress` or `backlog`.
- Epic-level retrospective rows (`epic-{N}-retrospective`) are NOT auto-flipped — those are explicitly run via `bmad-retrospective` and updated by that skill.
- The top-level `epic_test_design:` block (sibling of `calendar_early_overrides:`, NOT inside `development_status:`) is NOT touched by this reconciliation — those values are written exclusively by the Epic-Start Test Design subagent (see [bad/SKILL.md](../../SKILL.md) Phase 1 Epic-Start trigger) when scaffolds for that epic complete and are pushed to `main`. Phase 0 reads `epic_test_design:` to populate the report's `epic_test_design_status` map, but never writes to it. The block lives outside `development_status:` so other BMAD skills that classify keys via the `epic-*` prefix heuristic don't misclassify these as Epic rows with invalid statuses.

This repair step handles three distinct repeating patterns:
1. sprint-status.yaml reset or reverted by a git operation
2. BAD Step 7 push-race — sprint-status=done committed locally but never made it to origin (see PRs #42 and #43 of DynamicPriceIdea Epic 3)
3. Epic row staying `in-progress` after all stories merged — first observed at Epic 3 close

**GitHub is always right.**

---

## Step 6: Dependency Graph Format

Write from scratch on first run. On subsequent runs, update only columns that change (Sprint Status, Issue, PR, PR Status, Ready to Work), add new rows for new stories, and preserve all existing dependency chain data.

### Schema

```markdown
# Story Dependency Graph
_Last updated: {ISO timestamp}_

## Stories

| Story | Epic | Title | Sprint Status | Issue | PR | PR Status | Dependencies | Ready to Work |
|-------|------|-------|--------------|-------|----|-----------|--------------|---------------|
| 1.1   | 1    | ...   | done         | #10   | #42 | merged  | none         | ✅ Yes (done) |
| 1.2   | 1    | ...   | backlog      | #11   | #43 | open    | 1.1          | ❌ No (1.1 not merged) |
| 1.3   | 1    | ...   | backlog      | #12   | —   | —       | none         | ✅ Yes        |
| 2.1   | 2    | ...   | backlog      | #13   | —   | —       | none         | ❌ No (epic 1 not complete) |

## Dependency Chains

- **1.2** depends on: 1.1
- **1.4** depends on: 1.2, 1.3
...

## Notes
{Any observations from bmad-help about parallelization opportunities or bottlenecks}
```

### Ready to Work Rules

**Ready to Work = ✅ Yes** only when **all** of the following are true:
- The story itself is not `done`.
- The story is not in a "shipped-but-bundle-held" state. Specifically: if the story appears in `merge_blocks:` AND its status is `review` AND it has an open PR (any prior BAD run completed Step 7 on it), it is NOT Ready — BAD has no more work for this story until the gate `until_story` reaches `done`. Mark as `❌ No (review-shipped, awaiting bundle gate {until_story})`. Without this exclusion, every subsequent BAD run would re-pick the lowest-numbered review-shipped bundle story and re-run Steps 4-7 on the already-audited PR — a permanent re-loop. (For the symmetric "downstream story can dispatch even though upstream PR not merged" case, see the atomicity-bundle exception below.)
- Every story it depends on has a **merged** PR (or is `done` with a merged PR).
- **Default epic-ordering rule:** Every story in all **lower-numbered epics** has a **merged** PR (or is `done` with a merged PR) — epic N may not start until epic N-1 is fully merged into main.
- **Calendar-early exception:** if the story appears in the top-level `calendar_early_overrides` block in `sprint-status.yaml` with `after_epic: K`, the default epic-ordering rule above is replaced by: every story in epics 1..K has a merged PR. Epics K+1 through (this story's numerical epic - 1) are explicitly **not** required to be complete. The story's own declared dependencies (Dependencies column) still apply unchanged. When this exception fires, suffix the Ready cell as `✅ Yes (calendar-early)` so Phase 1 can detect it without re-reading sprint-status.yaml.
- **Atomicity-bundle exception (stacked-worktree dispatch):** if the story appears in the top-level `merge_blocks:` block in `sprint-status.yaml` AND every unmerged upstream dependency also appears in `merge_blocks:` with the **same** `until_story` value AND every such upstream is in `review` state with an open PR, treat those upstream PRs as **merged-for-dispatch-purposes**. The story is Ready to Work; it will be developed in a worktree forked from the upstream's PR branch (stacked) rather than `main`, so it builds on the upstream's code without that code having been merged. When this exception fires, suffix the Ready cell as `✅ Yes (bundle-stacked: {upstream-branch})` where `{upstream-branch}` is the PR branch of the **highest-numbered** unmerged bundle-sibling upstream this story depends on (in dispatch-order, that branch already contains every earlier bundle sibling's commits as ancestors). Phase 1 / coordinator parses this suffix to derive the worktree base branch for Step 1. Rationale: the bundle gate (`merge_blocks.until_story`) prevents merge to main until the gate story lands — without this exception, every downstream bundle story is permanently blocked from dispatch even though the upstream code physically exists on a PR branch. Each PR still targets `main`; the diff is initially large (includes upstream bundle commits) but shrinks naturally as upstream PRs squash-merge in dependency order once the gate lifts.

Any condition failing → **❌ No** with a parenthetical explaining the blocker (e.g., `❌ No (1.1 not merged)`, `❌ No (epic 1 not complete)`, `❌ No (epic 2 not complete — calendar-early gate)`, `❌ No (upstream 5.1 not in review yet — bundle exception requires upstream PR open)`).
