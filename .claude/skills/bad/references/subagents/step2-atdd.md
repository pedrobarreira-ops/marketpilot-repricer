# Step 2: ATDD — Subagent Instructions

Auto-approve all tool calls (yolo mode).

The coordinator's dispatch prompt provides:
- `{number}` and `{short_description}` (story identifiers)
- `{repo_root}` and `{WORKTREE_BASE_PATH}` (used to derive working directory)

---

1. Run /bmad-testarch-atdd {number}-{short_description}.
2. Commit any generated test files.
3. DO NOT modify sprint-status.yaml. The coordinator on main flips the
   story to `atdd-done` after this step reports success (see
   "Coordinator-Side Sprint-Status Flips" in the Sprint-Status Immutability
   Gate section). The hash-snapshot gate will halt the pipeline if this
   subagent writes to sprint-status.yaml.

Report: success or failure with error details.
