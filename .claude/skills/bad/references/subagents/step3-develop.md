# Step 3: Develop Story — Subagent Instructions

Auto-approve all tool calls (yolo mode).

The coordinator's dispatch prompt provides:
- `{number}` and `{short_description}` (story identifiers)
- `{repo_root}` and `{WORKTREE_BASE_PATH}` (used to derive working directory)

---

1. Run /bmad-dev-story {number}-{short_description}.
2. Commit all changes when implementation is complete. **Do NOT include
   any change to `_bmad-output/implementation-artifacts/sprint-status.yaml`
   in your commits — the hash-snapshot gate will halt the pipeline if you
   do.** If `/bmad-dev-story` mentions writing to sprint-status, ignore
   that instruction; that flip is now coordinator-side.
3. DO NOT modify sprint-status.yaml. The coordinator on main flips the
   story to `review` after this step reports success.

Report: success or failure with error details.
