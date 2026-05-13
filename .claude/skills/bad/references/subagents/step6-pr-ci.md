# Step 6: PR & CI — Subagent Instructions

Auto-approve all tool calls (yolo mode).

**Guardrail-override discipline (Q4, Bundle C close-out retro 2026-05-13)**: when a guardrail in this prompt conflicts with what your task requires, HALT and surface to the coordinator with a clear description of the conflict. Do NOT override based on own reasoning. Two sightings so far — Story 7.8 dev's "acceptable transient behavior for this branch" rationalization (PR #90 fake-gate) and PR #91 Step 6's `--force-with-lease` deviation. Both were technically defensible but lost operator agency. The force-push-when-orphan-remote case is now explicitly codified below (search "FORCE-PUSH EXCEPTION"); for any OTHER guardrail conflict, HALT.

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

   FORCE-PUSH EXCEPTION (codified at Bundle C close-out retro 2026-05-13 Q4 — PR #91 recovery): `git push --force-with-lease` is ALLOWED only when ALL of these hold: (a) `git fetch origin` shows the remote branch tip is NOT an ancestor of local HEAD (`git merge-base --is-ancestor origin/{branch} HEAD` returns non-zero), AND (b) the upstream PR that pushed the divergent history can be IDENTIFIED and has been CLOSED (`gh pr view <upstream-PR> --json state -q .state` returns `CLOSED`), AND (c) you are recovering from a documented SCP (Sprint Change Proposal) or coordinator-authorized re-dispatch. Use `--force-with-lease` NEVER plain `--force`. Log the exception verbatim in your Step 6 report so the coordinator can verify.

   **DENY-BY-DEFAULT (belt-and-suspenders, 2026-05-13):** if you CANNOT identify the upstream PR whose history diverged from local (e.g., `gh pr list` returns no matching PR for the remote branch, OR `git log origin/{branch}..HEAD` shows the divergence point has no associated PR), condition (b) FAILS by default and force-push is NOT authorized — HALT. Do not interpret "no upstream PR found" as "(b) is vacuous". Same outcome for any other unmet condition: any push-related issue outside this exception → HALT per guardrail-override discipline above; do NOT use `--force` or `--force-with-lease`.

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
   file lists, env var names, or CI status — read them.

   DO NOT include a "Files Changed" count line (e.g., "5 files changed,
   142 insertions(+), 18 deletions(-)") anywhere in the PR body. GitHub displays
   files-changed counts directly on the PR page; the line was a 4-sighting
   hallucination source (PRs #86/#87/#88/#89/#91 at Bundle C close-out retro
   2026-05-13 Q3) — removed as a failure surface entirely.

     1. File list (for filename verification only — no count claims):
          git -C {worktree_path} diff main --name-only
        Use output verbatim for any specific filename cited in the body.
        Never invent file paths.

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
   and #65 (Epic 2) both shipped with errors the prose check alone didn't catch
   — invented "DATABASE_URL + SUPABASE_SERVICE_ROLE_KEY" pair (only
   SUPABASE_SERVICE_ROLE_DATABASE_URL existed), and "GitHub Actions skipped:
   RUN_CI_LOCALLY=true" while CI actually ran green. Read command outputs
   first; don't reason about facts that have a ground-truth source.

   COUNT-CATEGORY LABELLING — when citing counts in the PR body (tests, ACs,
   assertions, findings), explicitly label what's being counted. Do NOT
   conflate categories. Examples of imprecise phrasing that has slipped past
   this guard: "covers 10 acceptance criteria" when actually 2 ACs in 10 scan
   assertions; "8 tests added" when 8 includes both test cases and
   sub-assertions. Correct form: "X test cases", "Y ACs covered", "Z scan
   assertions across N ACs". Added at Epic 5 retro because the specifics-only
   rule doesn't catch counting semantics.

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
