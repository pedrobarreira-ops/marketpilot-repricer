# Step 3: Develop Story — Subagent Instructions

Auto-approve all tool calls (yolo mode).

The coordinator's dispatch prompt provides:
- `{number}` and `{short_description}` (story identifiers)
- `{repo_root}` and `{WORKTREE_BASE_PATH}` (used to derive working directory)

---

0. **Before implementing with any npm dependency**, fetch its current docs via
   Context7 MCP (use `resolve-library-id` then `get-library-docs`). If Context7
   is unavailable, proceed with training data and note which libraries you
   couldn't verify.
1. Run /bmad-dev-story {number}-{short_description}.
2. **Before writing any integration test SQL query**, grep the relevant
   migration files to verify every column name exists:
   ```bash
   grep -n "column_name_you_plan_to_use" supabase/migrations/
   ```
   Never invent column names from spec language (e.g. "a01_shop_id" from
   "A01 shop_id field") — always read the actual DDL. Wrong column names
   pass static analysis and code review but crash at runtime (42703).
   (Root cause of Story 4.3 key-entry test failures 2026-05-07.)

3. Commit all changes when implementation is complete. **Do NOT include
   any change to `_bmad-output/implementation-artifacts/sprint-status.yaml`
   in your commits — the hash-snapshot gate will halt the pipeline if you
   do.** If `/bmad-dev-story` mentions writing to sprint-status, ignore
   that instruction; that flip is now coordinator-side.
3. DO NOT modify sprint-status.yaml. The coordinator on main flips the
   story to `review` after this step reports success.

Report: success or failure with error details.
