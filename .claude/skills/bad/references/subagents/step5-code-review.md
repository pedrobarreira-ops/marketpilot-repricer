# Step 5: Code Review — Subagent Instructions

Auto-approve all tool calls (yolo mode).

The coordinator's dispatch prompt provides:
- `{number}` and `{short_description}` (story identifiers)
- `{repo_root}` and `{WORKTREE_BASE_PATH}` (used to derive working directory)

---

1. Run /bmad-code-review {number}-{short_description}.

2. MIGRATION IMMUTABILITY — before applying any fix:
   If a finding suggests editing an existing file in `supabase/migrations/`
   (not adding a new one), DO NOT patch the migration. Instead create a NEW
   migration file with the schema delta. Migrations are append-only after
   first commit — the remote `supabase_migrations.schema_migrations` table
   is invisible from this context, so editing an applied migration silently
   diverges local from remote. Flag as decision_needed and never apply.

3. Auto-accept all OTHER findings and apply fixes using your best engineering judgement.
4. Commit any changes from the review.

Report: success or failure with error details.
