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

0.5. **Test command policy** — when `/bmad-dev-story`'s workflow says "run tests"
   during red-green-refactor (its Steps 5, 7, 8 — per-task green-phase checks
   and per-task regression checks), use `npm run test:unit` (~1m38s). Use the
   full `npm test` (~20m) **only** at workflow Step 9 ("Run the full regression
   suite"), as the final pre-completion gate. Rationale: the full suite includes
   DB-bound integration tests that CI on the PR re-runs anyway (Step 6 of BAD).
   Running it 4–8× per story inside Step 3 burns 60–140 min per story for no
   safety gain — `test:unit` covers all unit + worker + route tests fail-fast.
   Story 5.1 timing showed Step 3 was 12m 16s with 91 tool uses; this policy
   targets that.

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

3. **After writing any migration that adds or removes RLS policies on a
   table**, grep `tests/` for existing assertions on that table's policies:
   ```bash
   grep -rn "tablename = 'your_table'" tests/
   grep -rn "policyname.*your_table\|your_table.*polic" tests/
   ```
   Story 4.3 added `scan_jobs_insert_own` without updating Story 4.2's test
   that asserted zero modify policies — breaking CI on all subsequent PRs
   (2026-05-07). Find and update any conflicting assertions before committing.

4. **When integration tests need to log a user in via the app** (POST /login,
   session cookie), create users via the GoTrue admin REST API — never via
   direct SQL INSERT. Direct SQL inserts are invisible to GoTrue's internal
   state: the admin list endpoint returns `{}` for them and admin PUT returns
   500, so the login flow always fails.
   ```javascript
   // ✅ correct — visible to GoTrue login flow
   const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users`, {
     method: 'POST',
     headers: {
       Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
       apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
       'Content-Type': 'application/json',
     },
     body: JSON.stringify({ email, password: TEST_PASSWORD, email_confirm: true,
       user_metadata: { first_name: '...', last_name: '...', company_name: '...' } }),
   });
   const { id: userId } = await res.json();

   // ❌ wrong — direct SQL insert invisible to GoTrue admin API
   await pool.query(`INSERT INTO auth.users ...`);
   ```
   Root cause of Story 4.6 scan-failed.test.js (2026-05-07): 6/8 tests failed
   because users were seeded via SQL then looked up via GET /admin/users → not found.

5. Commit all changes when implementation is complete. **Do NOT include
   any change to `_bmad-output/implementation-artifacts/sprint-status.yaml`
   in your commits — the hash-snapshot gate will halt the pipeline if you
   do.** If `/bmad-dev-story` mentions writing to sprint-status, ignore
   that instruction; that flip is now coordinator-side.
5. DO NOT modify sprint-status.yaml. The coordinator on main flips the
   story to `review` after this step reports success.

Report: success or failure with error details.
