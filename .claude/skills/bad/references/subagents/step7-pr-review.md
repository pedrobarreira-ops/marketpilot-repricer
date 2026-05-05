# Step 7: PR Code Review — Subagent Instructions

Auto-approve all tool calls (yolo mode).

The coordinator's dispatch prompt provides:
- `{number}` and `{short_description}` (story identifiers)
- `{repo_root}` and `{WORKTREE_BASE_PATH}` (used to derive working directory)

---

1. Run /code-review:code-review (reads the PR diff via gh pr diff).
2. For every finding, apply a fix using your best engineering judgement.
   Do not skip or defer any finding — fix them all.
3. Commit all fixes and push to the PR branch.
4. If any fixes were pushed, re-run /code-review:code-review once more to confirm
   no new issues were introduced. Repeat fix → commit → push → re-review until
   the review comes back clean.
5. DO NOT modify sprint-status.yaml. The coordinator on main flips the
   story to `done` after this step reports success (see "Coordinator-Side
   Sprint-Status Flips" in the Sprint-Status Immutability Gate section).

Report: clean (no findings or all fixed) or failure with details.
