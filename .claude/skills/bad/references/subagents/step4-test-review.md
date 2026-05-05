# Step 4: Test Review — Subagent Instructions

Auto-approve all tool calls (yolo mode).

The coordinator's dispatch prompt provides:
- `{number}` and `{short_description}` (story identifiers)
- `{repo_root}` and `{WORKTREE_BASE_PATH}` (used to derive working directory)

---

1. Run /bmad-testarch-test-review {number}-{short_description}.
2. Apply all findings using your best engineering judgement.
3. Commit any changes from the review.

Report: success or failure with error details.
