# Phase 5.5 Migration Analyst — Subagent Instructions

The coordinator's dispatch prompt provides:
- `{N}` (the merged PR number)
- `MIGRATION_FILES_LIST` — pre-computed by the coordinator via `gh pr diff {N} --name-only | grep "supabase/migrations/"`. Use this list directly; do NOT re-query GitHub (prevents stale-variable bugs in sequential multi-PR loops — PR #73 miss 2026-05-07).
- `{repo_root}` — absolute path to repo root; needed for the local-only migration pre-check below.

Auto-approve all tool calls (yolo mode).

---

Your job has TWO parts: (1) check that no local-only migrations are unapplied to remote (regardless of whether THIS PR touches migrations); (2) classify whether THIS PR's migrations are destructive.

## Step 1: Pre-check — verify no local-only migrations unapplied on remote

Run from `{repo_root}`:
```bash
npx supabase migration list 2>&1
```

Parse the output. Each row shows three columns: `Local`, `Remote`, `Time (UTC)`. Look for rows where `Local` is populated but `Remote` is empty (blank column) — these are migrations on the local file system that have not been applied to remote.

If ANY such row exists, output exactly:
```
migration_files: []
requires_confirmation: true
dangerous_ops_description: ⚠ {N} local migration(s) not yet applied to remote: {comma-separated local timestamps}. Typically from a prior manually-merged PR that bypassed BAD's Phase 5.5b auto-push (e.g., Bundle C PR #91 mega-merge 2026-05-11), OR a prior Phase 5.5b failure. Run `npx supabase db push --include-all` from {repo_root} to apply them. The --include-all flag is REQUIRED when local timestamps are earlier than already-applied remote timestamps (see `reference_supabase_migration_push_gotchas` memory). Phase 5.5b's auto-push uses --include-all, so [C] from the coordinator menu will resolve this — OR you can run the command manually and re-trigger BAD.
```
And stop. The coordinator's existing `requires_confirmation: true` halt path fires; on `[C]` it proceeds to Phase 5.5b which pushes via `db push --include-all`.

If no unapplied-on-remote rows exist, continue to Step 2.

## Step 2: Check the pre-computed migration file list

Use `MIGRATION_FILES_LIST` from the dispatch prompt.

If the list is empty or "(none)", output exactly:
```
migration_files: []
requires_confirmation: false
dangerous_ops_description: No migration files in this PR; remote is in sync with local.
```
And stop.

## Step 3: Read each migration file

For each migration file found, read its full contents from disk.

## Step 4: Classify

For each file, check for these **dangerous** SQL patterns (data loss risk):
- `DROP TABLE` — permanent table + data deletion
- `DROP COLUMN` or `ALTER TABLE ... DROP COLUMN` — column data gone forever
- `TRUNCATE` — all rows in the table gone
- `DELETE FROM` without a `WHERE` clause — bulk row deletion
- `ALTER TABLE ... RENAME TO` — could break application code silently

These are **safe** (additive, nothing existing affected — do NOT flag):
- `CREATE TABLE`, `CREATE TABLE IF NOT EXISTS`
- `CREATE INDEX`, `CREATE UNIQUE INDEX CONCURRENTLY`
- `ALTER TABLE ... ADD COLUMN` (with or without DEFAULT)
- `CREATE POLICY` — additive
- `DROP POLICY` immediately followed by `CREATE POLICY` on the same table in the same file — policy replacement, not data loss
- `CREATE TRIGGER`, `CREATE OR REPLACE FUNCTION`
- `INSERT INTO` — seed data
- `GRANT`, `REVOKE` — permissions only
- Partition creation (`CREATE TABLE ... PARTITION OF`)

## Step 5: Output

**If no dangerous ops found:**
```
migration_files: [list each file on its own line]
requires_confirmation: false
dangerous_ops_description: All migrations are additive — no data loss risk.
```

**If dangerous ops found** — write plain English Pedro (non-developer) can understand. Be specific about WHAT data would be lost:
```
migration_files: [list each file on its own line]
requires_confirmation: true
dangerous_ops_description: This migration permanently deletes the "shop_api_keys" table and all the data stored in it. Once applied to the database, this cannot be undone. Only confirm if you are certain this table is no longer needed.
```

Output ONLY the structured text above. No preamble, no commentary.
