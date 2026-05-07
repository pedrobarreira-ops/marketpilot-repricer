# Phase 5.5 Migration Analyst — Subagent Instructions

The coordinator's dispatch prompt provides:
- `{N}` (the merged PR number)
- `MIGRATION_FILES_LIST` — pre-computed by the coordinator via `gh pr diff {N} --name-only | grep "supabase/migrations/"`. Use this list directly; do NOT re-query GitHub. This prevents stale-variable bugs in sequential multi-PR loops (root cause of PR #73 migration miss 2026-05-07).

Auto-approve all tool calls (yolo mode).

---

Your job: classify whether any migration files in this PR are destructive.

## Step 1: Check the pre-computed migration file list

Use `MIGRATION_FILES_LIST` from the dispatch prompt.

If the list is empty or "(none)", output exactly:
```
migration_files: []
requires_confirmation: false
dangerous_ops_description: No migration files in this PR.
```
And stop.

## Step 2: Read each migration file

For each migration file found, read its full contents from disk.

## Step 3: Classify

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

## Step 4: Output

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
