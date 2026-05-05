# Step 6: PR & CI — Subagent Instructions

Auto-approve all tool calls (yolo mode).

The coordinator's dispatch prompt provides:
- `{number}` and `{short_description}` (story identifiers)
- Working directory at `{repo_root}/{WORKTREE_BASE_PATH}/story-{number}-{short_description}`

You also have access to two BAD config values from `.claude/settings.json`:
- `RUN_CI_LOCALLY` (boolean)
- `MONITOR_SUPPORT` (boolean)

---

1. Commit all outstanding changes.

2. BRANCH SAFETY — verify before pushing:
     git branch --show-current
   If the result is NOT story-{number}-{short_description}, stash changes, checkout the
   correct branch, and re-apply. Never push to main or create a new branch.

3. Look up the GitHub issue number for this story:
   Read the story's section in `_bmad-output/planning-artifacts/epics.md` and extract
   the `**GH Issue:**` field. Save as `gh_issue_number`. If the field is absent
   (local-only mode — no GitHub auth), proceed without it.

4. Run /commit-commands:commit-push-pr.
   PR title: story-{number}-{short_description} - fixes #{gh_issue_number}
   Include "Fixes #{gh_issue_number}" in the PR description body (omit only if
   no issue number was found in step 3).

   PR BODY DATA-GROUNDING RULE — BEFORE drafting the body, run these commands
   in the worktree and COPY from their outputs. Do NOT reason about
   file counts, file lists, env var names, or CI status — read them.

     1. File-count + file list (always run first):
          git -C {worktree_path} diff main --stat
          git -C {worktree_path} diff main --name-only
        Use the EXACT line from `--stat` (e.g. "5 files changed, 142 insertions(+), 18 deletions(-)")
        for any "X files changed" claim. Use `--name-only` output verbatim for any
        list of changed files. Never invent file paths or hand-count.

     2. Env var names referenced in the diff:
          git -C {worktree_path} diff main | grep -oE "process\.env\.[A-Z_][A-Z0-9_]*" | sort -u
        Only cite env var names that appear in this output. Never construct
        "X + Y" env-var pairs unless BOTH names appear in the grep output.

     3. CI status (only after the PR has been pushed and CI has run):
          gh pr checks {PR_NUMBER}
        Use the actual check names and statuses verbatim. Do NOT claim
        "CI skipped" or "GitHub Actions skipped: RUN_CI_LOCALLY=true" unless
        BOTH of these are true: (a) `gh pr checks` returns zero check rows,
        AND (b) the BAD config in `.claude/settings.json` actually has
        `RUN_CI_LOCALLY=true`. If RUN_CI_LOCALLY is not set, GitHub Actions
        ran — describe its actual result, do not claim it was skipped.

     4. Test counts:
          (parse the test runner's own output — `# pass N` / `# fail N` lines from
           node:test, or jest's summary). Never aggregate across categories
           ("8 tests" lumping cases + sub-assertions).

   PR BODY HALLUCINATION GUARD (post-draft check) — after /commit-commands:commit-push-pr
   drafts the body, review against the actual diff BEFORE pushing. Only cite
   specific filenames, function names, table/column names, exact string values,
   env var names, CLI flags, or explicit behavioural claims (e.g. "adds retry
   logic", "emits X field") that you can confirm are present in the diff. For
   anything else, use general prose ("adds the route", "extends the worker").
   If the draft contains a specific claim you cannot verify in the diff,
   generalise it or remove it. This rule applies only to the PR BODY — the
   PR TITLE can be the story slug as-is.

   Why both the data-grounding rule AND the post-draft check exist: PRs #64
   and #65 (Epic 2) both shipped with data-grounded errors that the
   post-draft prose check alone didn't catch — "16 files changed" (actual: 15),
   invented "DATABASE_URL + SUPABASE_SERVICE_ROLE_KEY" pair (only
   SUPABASE_SERVICE_ROLE_DATABASE_URL existed), and "GitHub Actions skipped:
   RUN_CI_LOCALLY=true" claim while CI actually ran green. Reading command
   outputs first removes the temptation to reason about facts that have a
   ground-truth source.

   COUNT-CATEGORY LABELLING — when citing counts in the PR body (tests, ACs,
   assertions, changed files, findings), explicitly label what's being counted.
   Do NOT conflate categories. Examples of imprecise phrasing that has slipped
   past this guard: "the test file covers 10 acceptance criteria" when it
   actually covers 2 ACs in 10 scan assertions; "8 tests added" when 8 includes
   both test cases and sub-assertions. Correct form: "X test cases", "Y ACs
   covered", "Z scan assertions across N ACs", "K files changed". Added at
   Epic 5 retro (2026-04-20) because the specifics-only rule above doesn't
   catch counting semantics.

5. CI:
   - If RUN_CI_LOCALLY is true → skip GitHub Actions and run the Local CI Fallback below.
   - Otherwise, if MONITOR_SUPPORT is true → use the Monitor tool to watch CI status:
       Write a poller script:
         while true; do gh run view --json status,conclusion 2>&1; sleep 30; done
       Start it with Monitor. React to each output line as it arrives:
       - conclusion=success → stop Monitor, report success
       - conclusion=failure or cancelled → stop Monitor, diagnose, fix, push, restart Monitor
       - Billing/spending limit error in output → stop Monitor, run Local CI Fallback
       - gh TLS/auth error in output → stop Monitor, switch to curl poller from `references/coordinator/pattern-gh-curl-fallback.md`
   - Otherwise → poll manually in a loop:
       gh run view
     (If `gh` fails, use `gh run view` curl equivalent from `references/coordinator/pattern-gh-curl-fallback.md`)
     - Billing/spending limit error → exit loop, run Local CI Fallback
     - CI failed for other reason, or Claude bot left PR comments → fix, push, loop
     - CI green → report success

LOCAL CI FALLBACK (when RUN_CI_LOCALLY=true or billing-limited):
  Read `references/subagents/step6-ci-fallback.md` and follow its instructions exactly.

Report: success or failure, and the PR number/URL if opened.
