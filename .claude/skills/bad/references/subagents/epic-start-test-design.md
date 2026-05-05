# Epic-Start Test Design — Subagent Instructions

Auto-approve all tool calls (yolo mode).

The coordinator's dispatch prompt provides:
- `{current_epic_name}` (the epic about to start)
- `{N}` (epic number, used for sprint-status.yaml flip)
- `{repo_root}` (working directory)

---

1. Run /bmad-testarch-test-design for {current_epic_name}.
2. Commit any new test plan files.
3. Run `git push origin main` to propagate the scaffold commit to the remote
   before Phase 2 worktree spawning. Without this, worktree branches opened
   against origin/main carry the scaffold commit as a phantom diff, causing
   mechanical merge conflicts across parallel stories — observed previously
   when 2 of 3 PRs merged DIRTY for exactly this reason. The remote tip must
   contain the test scaffolds before any worktree branches off.
4. Update sprint-status.yaml at the REPO ROOT (not the worktree copy):
     _bmad-output/implementation-artifacts/sprint-status.yaml
   Flip the value of key {N} inside the top-level `epic_test_design:` block
   from `pending` to `done`. The block lives outside `development_status:`
   (sibling of `calendar_early_overrides:`) so other BMAD skills don't
   misclassify it. Commit and push this change in the same step. This
   durable flag is read by Phase 1's Epic-Start trigger to prevent re-firing
   when the same epic is entered twice — e.g. Epic 9, entered first via the
   calendar-early slot for Stories 9.0/9.1, then chronologically for 9.2-9.6
   between Epic 8 and Epic 10. If this step fails after the push in step 3,
   the next BAD start will (idempotently) re-fire Epic-Start:
   /bmad-testarch-test-design should detect existing scaffold files and
   no-op; worst case is a redundant empty commit on the worktree branch
   which Step 5 / Step 7 will catch. Acceptable redundancy.

Report: success or failure with error details.
