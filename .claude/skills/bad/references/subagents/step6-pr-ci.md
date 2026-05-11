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

     3. Test counts:
          (parse the test runner's own output — `# pass N` / `# fail N` lines from
           node:test, or jest's summary). Never aggregate across categories
           ("8 tests" lumping cases + sub-assertions).

   DO NOT include CI status in the PR body. GitHub displays check results
   in the PR UI automatically — writing CI status in the body produces a
   stale or wrong claim (CI has not run at PR-creation time). Remove any
   "GitHub Actions skipped" or "CI: ✅" lines that /commit-commands generates.

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

   AUTO-INJECT SKIP-LIVE-SMOKE MARKER FOR BUNDLE-STACKED PRs — read
   `_bmad-output/implementation-artifacts/sprint-status.yaml` and check whether
   this story's key (e.g. `6-1-shared-mirakl-pri01-writer-...`) appears in the
   top-level `merge_blocks:` block. If yes, the PR diff vs `main` will include
   inherited Mirakl-touching files from upstream bundle siblings, which would
   trigger bad-review's Live Smoke guard with a false positive. Append this
   exact line as the LAST line of the PR body before submission:
       [Skip-Live-Smoke: bundle-stacked (Bundle {bundle}) — bundle gate at story {until_story_short}; live smoke evidence is owned by upstream PR chain and the gate's integration test]
   where `{bundle}` is `merge_blocks:<story-key>:bundle` (e.g. `C`) and
   `{until_story_short}` is the dotted short form of `merge_blocks:<story-key>:until_story`
   (e.g. `7-8-end-to-end-...` → `7.8`). Stories absent from `merge_blocks:`
   skip this step. Eliminates the manual `gh pr edit` workaround for stacked
   PRs (Q3 demoted to W4 watch at Epic 5 retro 2026-05-08).

5. CI — read `RUN_CI_LOCALLY` from `_bmad/config.yaml` BEFORE any other CI action (Q2, Epic 5 retro: Story 5.2 Step 6 hung Monitor on no-checks-reported because RUN_CI_LOCALLY=true skips GitHub Actions entirely; the Monitor branch must not even be considered when true).

   **If `RUN_CI_LOCALLY` is true** → do NOT dispatch Monitor, do NOT poll `gh run view`. Read `references/subagents/step6-ci-fallback.md` and run the Local CI Fallback exactly. Report based on its exit. SKIP the rest of step 5 (the GitHub Actions branches below do not apply).

   **If `RUN_CI_LOCALLY` is false** — branch on `MONITOR_SUPPORT`:
   - `MONITOR_SUPPORT=true` → use the Monitor tool with poller `while true; do gh run view --json status,conclusion 2>&1; sleep 30; done`. React per line: success → stop+report; failure/cancelled → stop, diagnose, fix, push, restart Monitor; billing-limit error → stop, run Local CI Fallback; gh TLS/auth error → switch to curl poller (`references/coordinator/pattern-gh-curl-fallback.md`).
   - Otherwise → poll manually with `gh run view` in a loop (or curl equivalent if `gh` fails). Billing-limit → exit loop, run Local CI Fallback. Other failure or Claude bot PR comments → fix, push, loop. Green → report success.

LOCAL CI FALLBACK (when RUN_CI_LOCALLY=true or billing-limited):
  Read `references/subagents/step6-ci-fallback.md` and follow its instructions exactly.

Report: success or failure, and the PR number/URL if opened.
