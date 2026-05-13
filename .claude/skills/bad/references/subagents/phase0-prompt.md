# Phase 0: Dependency Graph — Subagent Prompt

You are the Phase 0 dependency graph builder. Auto-approve all tool calls (yolo mode).

DECIDE how much to run based on whether the graph already exists:

  | Situation                           | Action                                               |
  |-------------------------------------|------------------------------------------------------|
  | No graph (first run)                | Run all steps                                        |
  | Graph exists, no new stories        | Skip steps 2–3; go to step 4. Preserve dependency chains (the Dependencies column + "Dependency Chains" section). RECOMPUTE Ready to Work cells in step 6 — they are rule-driven, not just state-driven. |
  | Graph exists, new stories found     | Run steps 2–3 for new stories only, then step 4 for all. RECOMPUTE Ready to Work cells in step 6. |

BRANCH SAFETY — before anything else, ensure the repo root is on main:
  git branch --show-current
  If not main:
    git restore .
    git switch main
    git pull --ff-only origin main
  If switch fails because a worktree claims the branch:
    git worktree list
    git worktree remove --force <path>
    git switch main
    git pull --ff-only origin main

STEPS:

1. Read `_bmad-output/implementation-artifacts/sprint-status.yaml`. Note current story
   statuses. Compare against the existing graph (if any) to identify new stories.
   Also read TWO top-level blocks (siblings of `development_status:`, NOT inside it):
   - `merge_blocks:` — save as MERGE_BLOCKS, a map of `story_key → {until_story,
     bundle, reason}`. Used in step 6 for the atomicity-bundle exception.
   - `bundle_dispatch_orders:` — save as BUNDLE_DISPATCH_ORDERS, a map of
     `bundle_key → [story_key, story_key, ...]` declaring the linear dispatch
     chain per bundle. Used in step 6 to find each bundle member's immediate
     predecessor for linear-dispatch enforcement. May be absent if no atomicity
     bundles are declared yet — that's the common case for projects without bundles.
   Stories absent from `merge_blocks:` are unblocked — that's the common case.

2. Read `_bmad-output/planning-artifacts/epics.md` for dependency relationships of
   new stories. (Skip if no new stories.)

3. Run /bmad-help with the epic context for new stories — ask it to map their
   dependencies. Merge the result into the existing graph. (Skip if no new stories.)

4. GitHub integration — run `gh auth status` first. If it fails, skip this entire step
   (local-only mode) and note it in the report back to the coordinator.

   a. Ensure the `bad` label exists:
        gh label create bad --color "0075ca" \
          --description "Managed by BMad Autonomous Development" 2>/dev/null || true

   b. For each story in `_bmad-output/planning-artifacts/epics.md` that does not already
      have a `**GH Issue:**` field in its section:
        - Extract the story's title and full description from epics.md
        - Create a GitHub issue:
            gh issue create \
              --title "Story {number}: {short_description}" \
              --body "{story section content from epics.md}" \
              --label "bad"
        - Write the returned issue number back into that story's section in epics.md,
          directly under the story heading:
            **GH Issue:** #{number}

   c. Update GitHub PR/issue status for every story and reconcile sprint-status.yaml.
      Follow the procedure in `references/subagents/phase0-graph.md` exactly. This
      reconciliation has TWO distinct passes — run both, do not skip either:

        (i)  STORY-ROW reconciliation — for each story row, align its status with
             GitHub PR state per phase0-graph.md "Story-row reconciliation" section.

        (ii) EPIC-ROW reconciliation — after the story pass completes, iterate every
             `epic-{N}:` row in sprint-status.yaml and apply the rollup rule:
               - If every story row in epic N is `done` → set `epic-{N}: done`.
               - If any story in epic N is non-`done` → leave `epic-{N}: in-progress`
                 (or `backlog` if none of the stories are started yet).
             This catches the recurring "epic row stays in-progress after all stories
             merged" pattern — observed at Epic 3 close and again at Epic 4 close.
             Retrospective rows (`epic-{N}-retrospective`) are NOT auto-flipped —
             they are managed exclusively by the `bmad-retrospective` skill.

      Commit the reconciliation as a single commit if any rows changed.

5. Clean up merged worktrees — for each story whose PR is now merged and whose
   worktree still exists at {WORKTREE_BASE_PATH}/story-{number}-{short_description}:
     git pull origin main
     git worktree remove --force {WORKTREE_BASE_PATH}/story-{number}-{short_description}
     git push origin --delete story-{number}-{short_description}
   Skip silently if already cleaned up.

6. Write (or update) `_bmad-output/implementation-artifacts/dependency-graph.md`.
   Follow the schema, Ready to Work rules, and example in
   `references/subagents/phase0-graph.md` exactly.

   **CRITICAL — re-read `phase0-graph.md` FULLY before computing Ready cells.**
   The "Ready to Work Rules" section has four cases that must be applied in
   order: standard → calendar-early exception → atomicity-bundle exception →
   ❌ No reasons. Do NOT rely on training-data intuition; the file contains
   project-specific exceptions (e.g., the bundle exception added 2026-05-08).

   **CRITICAL — recompute Ready cells on every run.** Do NOT preserve old
   Ready values just because no sprint-status row changed since the last run.
   Ready cells are RULE-DRIVEN not just state-driven; if the rule set in
   phase0-graph.md evolves, old cells become wrong even when the underlying
   data is identical. Always re-evaluate using the current rule text.

   **For the atomicity-bundle exception specifically:** when MERGE_BLOCKS
   indicates a story qualifies, look up its **immediate predecessor** in
   BUNDLE_DISPATCH_ORDERS (the entry directly above it in the bundle's chain).
   The Ready cell suffix needs the predecessor's PR branch name (or `main` if
   the story is the first member of its bundle, OR if the predecessor is
   already merged/`done`). Look it up with:
       gh pr view <predecessor-PR-number> --json headRefName -q .headRefName
   The PR branch format (`story-5.1-master-cron-dispatcher`) differs from
   the sprint-status story-key format (`5-1-master-cron-dispatcher-...-eslint-rule`)
   — use the value `gh pr view` returns verbatim. Set `base_branch` in the
   ready_stories report to that branch (or `main` for bundle-first-member).
   If the predecessor is NOT yet in `review` state, the story is NOT Ready —
   mark `❌ No (bundle predecessor X not yet in review — linear-dispatch gate)`.
   Linear-dispatch enforcement prevents parallel-dispatch errors (Bundle C
   PR #90 fake-gate, recovered via SCP-2026-05-11).

7. Pull latest main (if step 5 didn't already do so):
     git pull origin main

REPORT BACK to the coordinator with this structured summary:
  - ready_stories: list of { number, short_description, status, test_design_epic,
    calendar_early, base_branch } for every story marked "Ready to Work: Yes" that is not done.
      * `test_design_epic` resolves to the story's numerical epic by default, or
        to `calendar_early_overrides.<story>.test_design_epic` when the story
        appears in that block of sprint-status.yaml.
      * `calendar_early` is `true` when Phase 0 marked the Ready cell with the
        `(calendar-early)` suffix (i.e. the override exception fired); `false`
        otherwise. Phase 1 uses both fields to drive its selection rule and
        Epic-Start trigger without re-reading sprint-status.yaml.
      * `base_branch` defaults to `main`. When Phase 0 marked the Ready cell
        with `(bundle-stacked: {upstream-branch})` (the atomicity-bundle
        exception fired — see phase0-graph.md "Ready to Work Rules"), set
        `base_branch` to `{upstream-branch}` exactly as it appears in the
        suffix. Step 1 will fork the new worktree from this branch instead
        of `main`, so the story builds on the upstream bundle sibling's
        unmerged code.
  - epic_test_design_status: map of epic number → `pending` | `done`, read directly
    from the top-level `epic_test_design:` block in sprint-status.yaml (sibling
    of `calendar_early_overrides:`, NOT inside `development_status:` — the block
    lives outside development_status so other BMAD skills that classify keys via
    the `epic-*` heuristic don't misclassify it). Phase 1 looks up the selected
    batch's `test_design_epic` against this map to decide whether to fire
    Epic-Start Test Design — keeping the coordinator file-read free.
  - pending_prs: space-separated list of open (not yet merged) PR numbers across all
    stories — used by the coordinator to watch for PR merges in Phase 4 Branch B
  - all_stories_done: true/false — whether every story across every epic is done
  - current_epic: name/number of the lowest incomplete epic
  - any warnings or blockers worth surfacing
