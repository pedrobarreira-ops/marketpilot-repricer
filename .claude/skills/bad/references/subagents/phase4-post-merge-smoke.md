# Phase 5.5 Push + Verify — Subagent Instructions

The coordinator's dispatch prompt provides:
- `{N}` (the merged PR number)
- `{repo_root}` (absolute path to repo root)

Auto-approve all tool calls (yolo mode).

---

## Step 1: Push migrations

Run from `{repo_root}`:
```bash
npx supabase db push --include-all
```

When prompted `[Y/n]`, answer `Y`.

Capture the output. If the command exits with a non-zero code, note the error and continue to Step 2 anyway (do not abort — partial push may still have applied some migrations).

## Step 2: Verify migrations applied to remote

Run:
```bash
npx supabase migration list 2>&1
```

Look for any migration files from this PR in the output. Confirm they show as applied (remote timestamp present). If any appear only as local (no remote timestamp), note them as "not confirmed applied".

## Step 3: Run integration tests

Run from `{repo_root}`:
```bash
npm run test:integration 2>&1
```

Capture: total tests, passed, failed, skipped. Note any failing test names.

## Step 4: Report

Output a clean summary in this exact format:
```
Post-merge smoke — PR #{N}

Migration push:     ✅ Success   (or ❌ Failed: <reason>)
Migration verified: ✅ Applied   (or ⚠️ Unconfirmed: <files not confirmed>)
Integration tests:  ✅ N pass, N skipped, 0 fail   (or ❌ N failed: <test names>)

Overall: ✅ PASS   (or ⚠️ FAIL — <one-line summary of what needs attention>)
```

Return only this report. No preamble.
