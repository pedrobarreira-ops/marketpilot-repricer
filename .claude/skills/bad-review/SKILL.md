---
name: bad-review
description: 'Audit a BAD-generated PR before merge — spawns parallel subagents to check code vs spec, MCP alignment, test quality, and PR-body accuracy, then guides a safe merge preserving any stranded BAD commits. Use when: "review PR #N", "audit BAD''s last PR", "check BAD''s work", "is this PR safe to merge", or when BAD reports a batch complete.'
---

# bad-review — Audit BAD-generated PRs before merge

## Purpose

BAD ships PRs autonomously. Its self-reports ("34/34 pass, clean review") are *sometimes* accurate and *sometimes* hide silent-failure bugs. This skill performs an independent audit using fresh-context subagents, then guides a safe merge that preserves any of BAD's sprint-status commits that got stranded on local via the push-race pattern.

## When to use

- BAD reports "Step 7 PR review clean" and you want to verify before merging
- You're about to `gh pr merge` a BAD PR and want to check nothing silently broke
- Epic-complete batches where multiple PRs landed and you want a consistency check
- Any time you don't trust the PR body (see project memory: `feedback_bad_pipeline_trust.md`)

## Args

- `<PR-number>` (optional) — e.g. `/bad-review 44`. If omitted, uses the most recent open PR whose branch starts with `story-`.

## Flow

```
Phase 1: Gather          [main context — ~5 tool calls]
Phase 2: Audit           [4 parallel subagents — each returns <400 words]
Phase 3: Synthesize      [main context — produces verdict + user HALT]
Phase 4: Merge           [only on user confirmation — main context, judgment-heavy]
Phase 5: Post-merge      [main context — verify main is clean]
```

---

## Phase 1: Gather

Run these in parallel — all `gh` CLI, no subagent needed:

1. `gh pr view <N> --json number,title,state,mergeable,mergeStateStatus,additions,deletions,changedFiles,body`
2. `gh pr diff <N> --name-only`
3. Locate the story spec file: look in `_bmad-output/implementation-artifacts/` for a filename matching the story number (e.g. `3-4-*.md` for Story 3.4). Parse from PR title (typical format: `story-3.4-<slug> - fixes #N`).
4. Locate the ATDD test file + any `.additional.test.js` / `.unit.test.js` supplements in `tests/`.
5. Check `gh pr checks <N>` — CI state. **If CI is not clearly green, run `npm test` locally as an authoritative fallback** (see "CI-pending guard" below).
6. **Cross-reference prior deferred items for this story-family.** Extract the story prefix from the PR title (e.g., `5-1` from `story-5.1-form-js-...`) and grep the deferred-work backlog for any entries that reference it or the same story slug:
   ```bash
   grep -nE "Story {story-id}|{story-prefix}-[a-z-]+\.md|code review of {story-prefix}-|PR #[0-9]+ review.*{story-prefix}" \
     _bmad-output/implementation-artifacts/deferred-work.md
   ```
   Also grep for the bare story prefix across the whole file as a safety net (`grep -nE "^- .*{story-prefix}[-.]" deferred-work.md`). Save the matching sections (section header + bullet titles) as `PRIOR_DEFERRED_ITEMS`. This is what the parent session would have known implicitly; dump it here so fresh sessions see it too.

Save the results as variables for the audit phase: `PR_NUMBER`, `PR_TITLE`, `STORY_FILE`, `CODE_FILES` (list), `TEST_FILES` (list), `PR_BODY`, `PRIOR_DEFERRED_ITEMS` (may be empty — that's fine).

**If PR state is not OPEN or mergeable is CONFLICTING:** stop. Report to user — "PR is <state>, cannot audit in this session." This skill does not resolve PR-branch conflicts.

### CI-pending guard (Phase 1 step 5 — authoritative local test run)

Background: BAD's Step 5/7 reviewer can land revert commits after Step 6 writes the PR body. The body's "X/Y passed" claim reflects pre-revert state. When GitHub Actions is paused (billing limits, rate limits) or the check is still running, the green-light on the PR does not exist yet — trusting the body here is how broken tests ship to main (observed on PR #53, 2026-04-21).

**Trigger this guard when `gh pr checks <N>` shows any of:**
- `mergeStateStatus: UNSTABLE` (CI still pending or a required check not yet completed)
- `status: pending` or `status: queued` on any required check
- Zero checks reported (Actions disabled/paused — common when billing caps trip)
- The PR body contains a "GitHub Actions skipped" / "billing limit" disclaimer

**What to do:**
1. Locate the PR's worktree at `.worktrees/<headRefName>` (BAD convention). Get `headRefName` from the Phase 1 step 1 JSON.
2. Run `npm test` there — treat its output as authoritative, not the PR body's claim. **Use synchronous Bash** — do NOT spawn `npm test` in background with the Monitor tool watching for completion. Synchronous Bash returns exit codes immediately; the background+Monitor pattern can stall the audit indefinitely if the test process hangs or never signals completion (root cause of PR #88 first-audit truncation at 11m 44s on 2026-05-11 — Monitor burned the subagent's context budget waiting for an npm test that never returned). If you need a long-running test, set Bash `timeout` explicitly rather than going async.
3. **If red:** promote to the same handling as "CI failing" (Rule 6) — report the failing tests and stop. Do not proceed to Phase 2.
4. **If green:** proceed to Phase 2 and note in the Phase 3 synthesis that the green-light came from a local run, not from GitHub Actions.
5. **If worktree missing** (unusual — only happens for externally-contributed PRs or after manual cleanup): halt and ask the user to check out the branch or wait for GitHub Actions. Do not skip the check.

This guard is cheap (~2 minutes of local test time) and closes the hole where a post-body revert breaks CI without anyone noticing.

### Live Smoke Evidence guard (Phase 1 step 7 — Mirakl-touching PRs only)

**Trigger:** `gh pr diff <N> --name-only` (from Phase 1 step 2) includes any
path matching one of:
  - `shared/mirakl/`                          (API client + helpers SSoT)
  - `worker/src/engine/`                      (repricing engine — calls P11/PRI01)
  - `worker/src/safety/`                      (circuit-breaker, anomaly-freeze, reconciliation — all Mirakl-adjacent)
  - `worker/src/jobs/`                        (cron entry points — pri02-poll, monthly-partition, etc.)
  - `app/src/routes/_public/onboarding-key.js` (initial key validation against Mirakl)
  - `app/src/routes/_public/onboarding-*.js`   (other onboarding routes that probe Mirakl)
  - `tests/fixtures/mirakl/`                  (P11/PRI01 fixtures — semantic drift risk)
  - `tests/fixtures/p11-*.json`               (the 17 P11 fixtures — bound to Bundle C gate)
(There is no `src/workers/mirakl/` in this repo — that's the legacy
DynamicPriceIdea path.)

**Required in PR body — exactly one of:**
  (a) A `## Live Smoke Evidence` section summarising a real-credential run
      against Mirakl: observed HTTP status(es), response-shape confirmation,
      and reference to the recording file (e.g. `live-smoke-epic-N.md`), OR
  (b) An explicit skip marker on its own line: `[Skip-Live-Smoke: <reason>]`
      where `<reason>` is human-readable (e.g. "test-only refactor, no endpoint
      paths touched" / "Epic is backend-only, no Mirakl work" / "retroactive
      smoke scheduled for pre-MVP ship checklist").

**What to do:**
1. If (a) present: record "live smoke documented" and proceed to Phase 2.
2. If (b) present: record the skip reason verbatim in Phase 3 synthesis so the
   reviewer sees it. Proceed to Phase 2.
3. If neither: HALT. Do not enter Phase 2. Report:
   `❌ Mirakl-touching PR missing live-smoke evidence. PR #{N} touches
   {matched-paths} but PR body contains no "## Live Smoke Evidence" section
   and no "[Skip-Live-Smoke: <reason>]" marker. Add one of these to the PR
   body and re-run /bad-review.`

Rationale: Epic 7 was the first-trigger epic for the external-API smoke gate
and the gate did not fire. Memory-rule-only (`feedback_external_api_smoke_gate.md`)
was not load-bearing; this is the harness version. See also memory
`feedback_bad_review_live_smoke_gate.md` for the escape-hatch design rationale.

### Filename claim audit (Phase 1 step 8 — deterministic PR body vs diff)

Extract candidate file-path tokens from the PR body using this regex:

```
\b(?:[a-zA-Z0-9_\-./]+\.(?:js|md|yaml|yml|json|css|html|sql|ts|tsx|sh|py)|(?:app|worker|shared|supabase/migrations|db|tests|tests/integration|tests/fixtures|scripts|_bmad-output|\.claude|\.agents|\.githooks|eslint-rules)/[a-zA-Z0-9_\-./]+)\b
```

For each extracted token:
- If it exactly matches (or is a suffix match of) any line in `gh pr diff <N> --name-only`, drop it (backed by diff).
- Otherwise, add to `HALLUCINATED_FILENAMES`.

Save `HALLUCINATED_FILENAMES` as a variable (may be empty). In Phase 3
synthesis, include a "## Filename claim audit" section listing any
hallucinated tokens — as a **warning, not a HALT** — because these are
cosmetic, not regressions. Phase 4.5 records the audit result in
`deferred-work.md` under the usual convention if any are found.

Rationale: Epic 7 Challenge #7 — 3/3 PRs had cosmetic filename hallucinations
that memory rule `feedback_bad_pipeline_trust.md` alone was not deterministically
catching. This offloads 80%+ of the hallucination class into a Phase 1
pre-check.

### Migration immutability guard (Phase 1 step 9 — deterministic, hard halt)

**Trigger:** runs on every PR, not just Mirakl-touching ones.

Check whether the PR modifies any migration file that already exists in main:

```bash
git log --diff-filter=M --name-only HEAD -- 'supabase/migrations/*.sql' | sort -u
```

(Equivalent for the legacy path if encountered: `db/migrations/*.sql`. Architecture
treats `supabase/migrations/` as the canonical location going forward.)

**What to do:**
1. If the command returns ANY filenames: HALT. Do not enter Phase 2. Report:
   `❌ Migration immutability violation. PR modifies {file}. Migrations are
   append-only after first commit — never edit after the migration is part
   of git history. Create a NEW migration file with the schema delta and
   re-open the PR.`
2. If empty: proceed to Phase 2.

Rationale: Story 1.1's CR pass edited an already-applied migration to add an
index instead of creating a new migration. Practical consequence: `npx supabase
db push` skips already-tracked migrations, so the local file diverges silently
from the remote DB. In a multi-environment setup (local dev / staging / prod),
this surfaces as bug reports that don't reproduce locally and forces manual
schema reconciliation under pressure. The remote `schema_migrations` table is
invisible from subagent reasoning — this requires a mechanical gate. Higher
priority than path-pattern updates because the failure mode is a multi-day
production incident, not just a performance miss.

The same rule is mirrored in `references/mcp-forbidden-patterns.md` (Pattern: Modified
migration in `supabase/migrations/`) so Subagent A flags it as BLOCKING during
code-vs-spec audit.

**Purpose of `PRIOR_DEFERRED_ITEMS`:** used in Phase 3 to (a) deduplicate observations — if an audit subagent surfaces a finding that's already recorded in deferred-work, label it as "previously deferred" rather than a new finding; (b) flag patterns — if the same kind of observation appears across two or more PRs in the same story-family, that's signal for a retro discussion. Without this step, fresh `/bad-review` sessions would re-log the same observation on every PR.

### Mirakl MCP availability pre-check (Phase 1 step 10 — Q5, Epic 6 retro)

**Trigger:** any time `gh pr diff <N> --name-only` (from Phase 1 step 2) matches the same Mirakl-touching path list as the Live Smoke Evidence guard above (`shared/mirakl/`, `worker/src/engine/`, `worker/src/safety/`, `worker/src/jobs/`, etc.) — i.e., the audit will need MCP for any spec/endpoint cross-reference.

**Check:** run `ToolSearch` with query `mcp__mirakl` and filter results by `/authenticate/i` (same pattern as `bad/SKILL.md` Story 6.1 MCP gate fix at commit `44622d6`). If filtered count > 0 (at least one non-auth Mirakl data tool exists), MCP is authenticated and active — set `MCP_AVAILABLE=true` and proceed to Phase 2 normally. If filtered count == 0 (only the two `*authenticate` tools or no results), MCP is disabled OR pending OR token-expired. Set `MCP_AVAILABLE=false` and pass that flag to Phase 2's subagent prompts.

**Fallback banner (passed to MCP-using subagents — A `code-vs-spec` and B `mcp-alignment`):** when `MCP_AVAILABLE=false`, the dispatch prompt MUST include this directive verbatim: `⚠ MCP_AVAILABLE=false — Mirakl MCP is unavailable for this audit run. Emit a banner at the top of your findings: "⚠ Mirakl MCP unavailable during this audit — Mirakl-API claims below are training-data fallback, NOT MCP-verified. Re-run /bad-review after re-authenticating MCP for a verified audit." Do NOT silently fall back to training-data without the banner.` Rationale: PR #84/#85 audit runs hit silent token expiry mid-flight; the audit appeared clean but rested on training data. Closing the silent-degrade hole.

---

## Phase 2: Audit — 4 parallel subagents

Launch all four in a **single message** (parallel execution). Each is self-contained — subagents have no prior context. Use the Explore agent type unless otherwise noted.

### Subagent A: Code vs spec

**Model: `opus`** — judgment-heavy AC coverage classification (✓/⚠️/✗ per AC requires reading code intent vs spec intent). Use the Agent tool's `model: "opus"` parameter regardless of `subagent_type`.

```
You are auditing story implementation vs spec for marketpilot-repricer
(a Mirakl marketplace repricing MVP in Node.js).

Story spec: {STORY_FILE}
Implementation files (may include none — e.g. a docs-only PR): {CODE_FILES}

Read `references/subagent-prompts/code-vs-spec.md` and follow its instructions exactly.
```

### Subagent B: MCP alignment

```
You are checking Mirakl MCP alignment for marketpilot-repricer.

Files to grep: {CODE_FILES}

Read `references/subagent-prompts/mcp-alignment.md` and follow its instructions exactly.
```

### Subagent C: Test quality

**Model selection:**
- **Default: `sonnet`** for Subagent C — classification (behavioral / keyword-grep / skeleton) is largely mechanical pattern-matching.
- **Critical-path: `opus`** when ANY file in `CODE_FILES` is under: `worker/src/`, `app/src/routes/`, `app/src/middleware/`, `shared/mirakl/`, `shared/audit/`, `shared/state/`, `shared/money/`, `shared/crypto/`, `supabase/migrations/`. Same path list as the BAD Step 5 Worker/Critical-Path Opus Gate. The judgment of "critical gaps" on these files is too important for Sonnet.

The verdict thresholds also tighten on critical-path stories — see the prompt below.

```
You are assessing test quality for a marketpilot-repricer story PR.

Target test files (any combination of ATDD, .additional, .unit): {TEST_FILES}
Implementation files (passed by coordinator — used to detect critical-path): {CODE_FILES}

Read `references/subagent-prompts/test-quality.md` and follow its instructions exactly.
```

### Subagent D: PR body vs diff (hallucination check)

Use the `general-purpose` subagent type (needs gh CLI access beyond Explore).

```
You are auditing a BAD-generated PR body for hallucinations.

PR number: {PR_NUMBER}

Read `references/subagent-prompts/body-vs-diff.md` and follow its instructions exactly.
```

---

## Phase 3: Synthesize

Once all four subagents return, synthesize a short verdict in main context. Before writing the verdict, **cross-reference each subagent's findings against `PRIOR_DEFERRED_ITEMS`** (from Phase 1 step 6). For any new observation that duplicates a prior deferred item (same file:line, same root cause, same security-invariant class), don't re-surface it as a new finding — flag it as "previously deferred, still not fixed" in the recommendation. This prevents fresh `/bad-review` sessions from re-logging the same observation across every PR in a story-family.

### Phase 3 pre-step: merge-block check (atomicity bundles)

Before writing the verdict, check whether the current story is part of an atomicity bundle that hasn't completed yet:

1. Read `_bmad-output/implementation-artifacts/sprint-status.yaml`. Look for a top-level `merge_blocks:` block.
2. If the current story's key (e.g. `6-1-shared-mirakl-pri01-writer-js-...`) appears in `merge_blocks`, extract the `until_story` value and the `bundle` + `reason` fields. Save as `MERGE_BLOCK_STATE`.
3. Look up the `until_story` value in `development_status:`. If its status is `done`, the block is satisfied — clear `MERGE_BLOCK_STATE`. Otherwise the block is active.
4. If `MERGE_BLOCK_STATE` is active, the verdict template MUST omit `[M] Merge now` from the menu — only `[F] Fix first` and `[S] Stop` are offered, regardless of subagent verdicts. The bundle-complete state of `main` is a hard invariant that overrides "all four green."

Save `MERGE_BLOCK_STATE` for use in the verdict template's recommendation section. If empty, normal merge-eligibility rules apply.

### Phase 3 pre-step: build the manual smoke checklist (non-developer review surface)

The technical verdict alone isn't actionable for a non-developer reviewer. Build a story-specific manual smoke checklist Pedro can work through after merge — concrete, observable steps in the deployed app or supabase or via `scripts/`.

Sources for the checklist (in priority order):
1. The story's Acceptance Criteria (already plain-language in BMAD spec format — "Given/When/Then").
2. Any `Pattern A/B/C contract` block in the story spec (visual references in `_bmad-output/design-references/screens/`).
3. UX-DR mappings cited in the story.

Categorize each smoke step by surface type — only include the categories that apply to this story:

- **UI surfaces** (story touches `app/src/views/` or `app/src/routes/` for HTML responses): observable click-throughs in the deployed app. E.g. "Open `/onboarding/key`, paste a known-bad key, click Validar — confirm inline red error in PT."
- **Backend routes** (`app/src/routes/` for JSON or no UI surface): curl + observable side effect. E.g. "POST `/audit/anomaly/<sku_id>/accept` with valid session — confirm 200 + sku_channel.frozen_for_anomaly_review = false in supabase."
- **Worker / cron** (`worker/src/`): trigger + observe audit log. E.g. "Trigger one cycle via `node worker/src/cli/trigger-cycle.js <customer_marketplace_id>` — confirm `cycle-start` and `cycle-end` rows appear in audit_log."
- **Schema / migrations** (`supabase/migrations/`): supabase-studio verification. E.g. "Supabase Studio → Tables → confirm `customer_marketplaces` row has `cron_state = 'PROVISIONING'` after signup; CHECK constraint blocks INSERT with `DRY_RUN` + null A01."
- **ESLint rules** (`eslint-rules/`): manual rule verification. E.g. "Add a `console.log` to any `worker/src/` file, run `npm run lint` — confirm rule fires."
- **Mirakl-touching** (`shared/mirakl/` or anything reaching live Worten): live-probe via `scripts/mirakl-empirical-verify.js`.

If the story is purely backend / no observable surface (e.g. an internal SSoT module with no caller yet), state explicitly: `No manual smoke applicable — verify via CI green + post-merge MCP grep (Phase 5 step 3).` Don't pad the checklist with synthetic steps.

Aim for **3–5 items**. Prefer the AC's most user-visible behavior over comprehensive coverage. The point isn't to re-test everything — it's to confirm the feature actually does the observable thing the spec promised.

```
# PR #{N} audit — {one-line verdict}

## For non-developer reader (TL;DR)  ← ALWAYS emit this section, ALWAYS first
A plain-language summary aimed at a non-developer. Write it as if Pedro
just opened the report and needs to know what to do next without reading
the technical sections below. Three required lines:

1. **Recommended action: [M] / [F] / [S].** One bracketed letter, no ambiguity.
   Map directly from the Overall verdict tier:
   - "Safe to merge" → [M] Merge — clean audit, no follow-ups.
   - "Merge with awareness" → [M] Merge — N minor follow-ups logged for future stories, no functional or security risk.
   - "Needs fixes first" → [F] Fix first — {one-line of what's blocking, plain language}.
   - "Bundle-blocked" → [F] Fix first or [S] Stop — this PR can't ship until {until_story} lands (atomicity bundle).

2. **What this PR did, in one sentence.** Plain language, no jargon. Example:
   "Adds a CI check that fails the build if a new database table is missing
   from the security-policy registry." NOT "Implements AC#5's
   convention_every_seed_table_is_in_regression_config negative assertion."

3. **When to pause and ask before clicking.** One line. Example:
   "If the deferred-findings list mentions anything you don't recognise, or
   if any audit section flags 'security' or 'data loss', pause and ask
   Claude to explain before merging. Otherwise the recommended action is
   safe to take."

Keep this section to 4-6 lines total. The technical sections below are for
Claude or for follow-up reading; this TL;DR is what Pedro acts on.

## Prior deferred context  ← include only if PRIOR_DEFERRED_ITEMS is non-empty
Prior deferred items that touch this story-family (from deferred-work.md):
- **<title from existing entry>** [source section] — summarise in one line.
  Status: still-open / superseded-by-this-PR / partially-addressed.

Flag if this PR ignored or contradicts a prior deferred item; otherwise just list for continuity.

## Code vs spec
{from Subagent A — copy the AC Coverage table + scope/contradictions bullets}

## MCP alignment
{from Subagent B — forbidden patterns row + any drift notes}

## Test quality
{from Subagent C — classification totals + critical gaps}

## PR body accuracy
{from Subagent D — body verdict + top hallucinations if any}

## Overall verdict

- **Safe to merge** — all four green
- **Merge with awareness** — one or two minor issues (e.g. body
  hallucination, acceptable test weakness); doesn't block
- **Needs fixes first** — AC deviation, MCP drift, or security gap
- **Bundle-blocked** — merge prevented by `merge_blocks:` until the gate
  story (`{until_story}`) reaches `done`; subagent verdicts are otherwise
  fine, but this story participates in atomicity bundle `{bundle}` and
  cannot ship to `main` until the bundle gate lands. Reason: `{reason}`.

## Manual smoke checklist  ← ALWAYS emit this section
Built from the story's AC + UX-DRs. After [M] Merge or after applying [F] Fix
fixes, work through these in the deployed app and report back. If a step
fails, the merge was premature — open a follow-up PR or revert.

{2-5 categorized steps from Phase 3 pre-step "build the manual smoke checklist".
Use the category headers from that step. Skip categories that don't apply.
If purely backend/no observable surface, state explicitly:
"No manual smoke applicable — verify via CI green + post-merge MCP grep (Phase 5 step 3)."}

## Recommendation
{1-2 sentences — what to do next, including merge-block status if applicable}

## Deferred findings  ← ONLY emit this section when verdict is "Merge with awareness"
  OR when verdict is "Safe to merge" but a subagent flagged non-blocking
  improvements (weak-but-acceptable test, PR body hallucination, etc.).
  Otherwise omit this section entirely.

**Deduplication rule:** before listing a finding here, check `PRIOR_DEFERRED_ITEMS`.
If the same observation is already recorded (same file:line or same root cause),
SKIP it in this new list. Instead, mention it in the Recommendation section as
"pattern recurring from [prior section header] — worth retro discussion" so the
recurrence is visible without creating a duplicate entry.

For each non-duplicate finding, format it exactly like existing entries
in `_bmad-output/implementation-artifacts/deferred-work.md`:

  - **<one-line title>** [file:line or "route" or "PR body"] — <short
    explanation>; <why deferred vs fixed now>.

Example:
  - **No test for queue.add() rejection path** [tests/epic4-4.1-*.test.js]
    — route has queue.add inside try/catch with db.updateJobError rollback,
    but no behavioral test asserts this path. Acceptable for MVP; add in
    Epic 4 retro or an .additional.test.js supplement.
  - **PR body claims "email trimming"** [PR body] — only api_key is
    trimmed in generate.js; email is passed through untouched. Cosmetic
    body overstatement per the known BAD Step 6 hallucination pattern.
```

Then **HALT and wait for user confirmation** before doing anything destructive. Present the menu — its shape depends on `MERGE_BLOCK_STATE`:

**Default menu (no merge block, verdict is "Safe to merge" or "Merge with awareness"):**
```
[M] Merge now — execute the safe-merge procedure
[F] Fix first — tell me what needs fixing, I'll wait
[S] Stop — I'll read your report and merge manually later
```

**Merge-block-active menu (verdict is "Bundle-blocked"):**
```
This story participates in atomicity bundle {bundle} and cannot merge until
{until_story} reaches `done`. {reason}

[F] Fix first — tell me what needs fixing, I'll wait
[S] Stop — I'll read your report and revisit when the gate lands
```

[M] Merge now is intentionally unavailable. The bundle invariant is hard.

**Blocking-issue menu (verdict is "Needs fixes first"):**
```
[F] Fix first — tell me what needs fixing, I'll wait
[S] Stop — I'll read your report and merge manually later
```

Do NOT auto-merge. The user must explicitly confirm.

---

## Phase 4: Merge (on user [M] confirmation)

Read `references/merge-procedure.md` and follow it exactly. Core steps:

1. **Stash any local dev-state changes** (e.g. `.claude/settings.local.json`) so they don't get swept into git state.
2. **Re-check PR mergeable state RIGHT BEFORE the merge** (not just what was captured at Phase 1 — state may have drifted if another PR merged in the meantime):
   ```bash
   gh pr view {PR_NUMBER} --json mergeable,mergeStateStatus
   ```
   - `mergeable: MERGEABLE, mergeStateStatus: CLEAN` → proceed to step 3.
   - `mergeStateStatus: BEHIND` → PR branch is behind main; auto-catch-up. See **"Pre-merge conflict handling"** in `references/merge-procedure.md`.
   - `mergeable: CONFLICTING, mergeStateStatus: DIRTY` → conflict. Try mechanical-conflict resolution (see below). If unresolvable, halt.
3. **Detect local/origin divergence** (local has BAD's stranded sprint-status commits):
   - Do NOT reset local to origin (would lose BAD's intent)
   - Do NOT merge-commit (messy history)
   - DO rebase local onto origin after the PR merge completes on GitHub
4. `gh pr merge <N> --squash --delete-branch` — GitHub handles the squash.
5. `git fetch origin main && git rebase origin/main` — replay any local commits onto the new tip.
6. **If rebase hits conflicts** (typically on the story spec file — "Status" field, checkboxes, or Dev Agent Record): resolve by keeping the MORE COMPLETE local version (BAD's post-review state has checkmarks + Dev Agent Record populated; origin's squashed state has raw unchecked skeleton).
7. **Check for conflict markers left behind** before continuing: `grep -c "<<<<<<< HEAD" <spec-file>`. If non-zero, fix them before pushing.
8. `git push origin main` — this completes the merge safely.
9. Pop the stash.
10. **Worktree + local-branch cleanup (UNCONDITIONAL after successful merge).** The PR's worktree (`.worktrees/story-{N}-<slug>/`) and local branch (`story-{N}-<slug>`) are no longer needed. Cleanup must run on every successful merge — never assume a future BAD Phase 0 will do it (with halt-after-batch, BAD may not run again for days):
    ```bash
    # Derive paths from the PR (title typically: "story-{N}-<slug> - fixes #M")
    WORKTREE=".worktrees/story-{N}-<slug>"
    BRANCH="story-{N}-<slug>"

    # Remove worktree — fails silently if already removed
    git worktree remove "$WORKTREE" 2>&1 || echo "(worktree already removed)"

    # Force-delete local branch — squash-merge gives different SHA so -D is required
    git branch -D "$BRANCH" 2>&1 || echo "(branch already removed)"

    # Verify cleanup
    git worktree list
    ```
    **If `git worktree remove` reports uncommitted changes**: halt and report — do NOT use `--force`. Uncommitted changes in a post-merge worktree are unusual and warrant Pedro's eyeball. The merge has already succeeded; Phase 5 can still proceed. The cleanup just doesn't complete in this session.

### Mechanical-conflict resolution (step 2 CONFLICTING case)

When `mergeStateStatus: DIRTY`, the PR branch conflicts with main. Do NOT immediately halt. First try known-mechanical auto-resolution:

1. **Check out the PR branch in its existing worktree** (`.worktrees/story-{N}-<slug>/`). Do NOT create a new worktree or change the main worktree's branch.
2. **Merge `origin/main` into the PR branch:**
   ```bash
   git -C <worktree-path> fetch origin main
   git -C <worktree-path> merge origin/main
   ```
3. **Identify conflicted files:** `git -C <worktree-path> diff --name-only --diff-filter=U`.
4. **For each conflicted file, check against the known-mechanical pattern list** in `references/merge-procedure.md` ("Known-mechanical conflict patterns"). If ALL conflicted files match known patterns, resolve each per the documented rule. If ANY conflicted file is outside the list, halt with a clear report to the user — this needs human judgment.
5. **After resolving:** run `npm test` in the worktree to verify no regression. If green, commit the merge resolution with a message like `"Merge origin/main — resolve <files> conflict (mechanical: <pattern>)"` and push. If red, halt with test output.
6. **Re-check mergeable state** — GitHub needs a few seconds to re-evaluate. Once `MERGEABLE`, return to step 4 of Phase 4.

**Never guess.** If the conflict pattern is unfamiliar, don't try to resolve it — halt and describe the conflicted files to the user.

### Rule on `cd` in Bash commands

Shell CWD persists across Bash tool calls in the same session. Avoid the stuck-in-worktree footgun:
- **Good:** `git -C <path> status`, `cd path && cmd` (CWD only persists within that one command), absolute paths.
- **Bad:** standalone `cd path` on its own line — the next Bash call will still be in that path.

If a `cd` is unavoidable (e.g. `npm test` doesn't support `-C`), pair it with the actual command: `cd path && npm test`.

**Do NOT proceed to Phase 5 if any step in Phase 4 fails.** Report the failure to the user and stop.

---

## Phase 4.5: Capture deferred findings (only if Phase 3 emitted any)

If the Phase 3 synthesis included a **## Deferred findings** block, close the loop before Phase 5 runs. Otherwise skip this phase entirely.

### Step 1 — Prompt the user

After the merge push completes, show:

```
Phase 3 flagged {N} non-blocking findings:
  <list the one-line titles from Phase 3, numbered>

Append these to `_bmad-output/implementation-artifacts/deferred-work.md`
under a new section "Deferred from: PR #{N} review ({ISO-date})"?

[Y] append + commit + push  |  [N] skip (findings live only in this chat log)
```

Wait for user reply. Do NOT auto-append.

### Step 2 — If user replied [Y]

1. **Read the full `deferred-work.md`** to (a) confirm the existing section-header format, and (b) check for overlap with items already captured by BAD's Step 5/7 code reviews. BAD's own reviews sometimes populate a `## Deferred from: code review of <story-slug>` section for the same PR, so genuine duplicates can exist.

   Current header pattern:
   ```
   ## Deferred from: <source> (YYYY-MM-DD)

   - **<title>** [file:line] — <explanation>.
   ```

2. **Deduplicate against existing entries.** For each finding in Phase 3's Deferred findings block:
   - If another entry in the file describes the **same root cause at the same file:line** (even if worded differently), drop this finding.
   - If a finding partially overlaps (same file but different concern, or related but independent root cause), keep it — over-appending is safer than silent omission.
   - When in doubt, **keep it and note the partial overlap in the commit message** rather than dropping.

   Track the dropped findings separately — they go in the commit message, not the yaml.

3. **Append** a new section at the end of the file. Include ONLY the non-duplicate findings:
   ```
   ## Deferred from: PR #{PR_NUMBER} review ({ISO-date})

   - **<finding 1 title>** [<location>] — <explanation>.
   - **<finding 2 title>** [<location>] — <explanation>.
   ...
   ```
   If dedup removed all findings, skip the append entirely — report to the user that all items were duplicates of existing entries.

4. **Commit and push** with a message that states both what was appended AND what was dropped:
   ```bash
   git add _bmad-output/implementation-artifacts/deferred-work.md
   git commit -m "Record deferred findings from PR #{PR_NUMBER} review

   {short list of appended items, one per line}

   {If any dropped as duplicates:}
   N finding(s) dropped as duplicates of existing entries:
   - {dropped finding} duplicates {existing section / line reference}.
   "
   git push origin main
   ```

5. **Confirm** to the user: `Appended {N} findings to deferred-work.md ({commit-sha}). Dropped {M} as duplicates.`  (Omit the "Dropped" clause if M=0.)

### Step 3 — If user replied [N]

No file changes. Just note in the Phase 5 final report: `Deferred findings NOT captured (user skipped).` This ensures the findings don't vanish silently — they're at least surfaced one more time in the session close.

### What NOT to do in Phase 4.5

- **Do not** append findings that were "blocking" in Phase 3 — those must be fixed, not deferred. (If verdict was "Needs fixes first", Phase 3 won't have emitted deferred findings, so this phase naturally skips.)
- **Do not** rewrite or reformat existing entries in deferred-work.md — only append.
- **Do not** split findings across multiple new sections — one PR review = one section.

---

## Phase 5: Post-merge verify

Run these in main context:

1. **Pull main** to ensure local matches origin.
2. **Sprint-status check**:
   ```bash
   # Actual format in sprint-status.yaml is `{epic}-{story}-<slug>:` — e.g.
   #   3-1-mirakl-api-client-with-retry: done
   #   4-1-post-api-generate-route: done
   # Grep for the {epic}-{story}- prefix. Do NOT use `{epic}.{story}` (e.g. `4.1`) —
   # that pattern does not appear in the yaml and the grep will return nothing.
   grep -nE "^  {epic}-{story}-" _bmad-output/implementation-artifacts/sprint-status.yaml
   ```
   Confirm the merged story shows `done`. If it shows `review`/`atdd-done`/anything else, the push race stranded it — apply a quick one-commit fix: edit the yaml to flip to `done`, commit, push.

   **Optional batching** (style choice — either is fine):
   - Default: commit the sprint-status fix as its own commit (`"Set story X to done in sprint-status (post-merge reconciliation)"`). Cleanest history when someone reads the log.
   - Batch with Phase 4.5: if Phase 4.5 ran [Y] and sprint-status also needs fixing, combine both edits into one commit (`"Post-merge: deferred-work + sprint-status reconciliation"`). Saves one commit per merge, marginally noisier commit message.
   - Do not batch if Phase 4.5 was skipped ([N]) or didn't fire (no deferred findings) — reconciliation stands on its own.
3. **MCP alignment smoke test** — confirm no regression:
   ```bash
   grep -rE "product_ids:\s*.*eans|\b(o|offer)\.channel_code\s*===|'X-Mirakl-Front-Api-Key'|\bBearer \$\{?(api_?key|apiKey)" \
     shared/mirakl worker/src/engine app/src/routes 2>/dev/null
   ```
   Expected: no matches (comments ok; only flag live param/field access).
   Also confirm migration immutability:
   ```bash
   git log --diff-filter=M --name-only origin/main -- 'supabase/migrations/*.sql' | sort -u
   ```
   Expected: empty (no modified migrations in main's history).
4. **Run `npm run test:unit`** — report pass/fail counts. We use `test:unit` (~1m38s) rather than full `npm test` (~20m) because step 5 below confirms CI on main, which runs the full integration suite. The local check exists to catch issues from the merge itself, and unit-level coverage is sufficient for that. If a new test file landed in this PR that's not in `npm test`'s allowlist, note it and offer to add it (until the `skipUnlessImplExists()` helper is in place).
5. **CI state on main** — `gh run list --branch main --limit 1 --json conclusion,displayTitle`. Should be `success` or in_progress. If failure, show the user the link. This is the integration-test safety net for the post-merge state.
6. **Final report** — a compact status:

```
# PR #{N} merged and main verified

- Merged: ✓ at {timestamp}
- Local commits preserved: {N rebased / none}
- sprint-status: ✓ {story} = done
- MCP alignment: ✓ intact
- npm run test:unit: ✓ {passed/total} pass
- CI on main: ✓ {conclusion}
- Deferred findings: ✓ {N} appended to deferred-work.md  ← when Phase 4.5 ran with [Y]
                     OR  ⚠ {N} flagged but NOT captured (user skipped)  ← [N]
                     OR  (omit this line when no findings)

Main is clean. Ready for next batch.
```

---

## Phase 5.5: Story summary + manual smoke prompt (non-developer review surface)

After Phase 5's final report prints, emit two things together: a plain-language summary of what the story actually shipped, then the manual smoke checklist (already built from the story's AC + UX-DRs in the Phase 3 pre-step). The summary tells the user what they now have; the checklist tells them how to verify it.

Build the **plain-language summary** by reading the story spec's Acceptance Criteria + the user-facing intent (NOT the technical architecture). Aim for 2-4 sentences a non-developer can read. Cover:
- What the system can now do (or what's now enforced) that it couldn't before.
- Who it affects (end user, ops, future stories).
- One concrete example if it helps.

Avoid jargon (no "RLS predicate", "preHandler middleware", "AC#5 convention test"). Translate. Example:
- ❌ "Adds the rls_context preHandler that binds request.db via SET LOCAL ROLE authenticated"
- ✅ "Every authenticated route now automatically scopes database queries to the logged-in customer — they physically can't read or write another customer's rows even if a route forgot to filter."

Format:

```
✅ Story {epic}.{story} completed — {one-line title from the story spec}

What this story added:
{2-4 sentence plain-language summary — what the system can now do that it
couldn't before, who it affects, one concrete example if helpful}

🧪 Manual smoke — verify the observable behaviour:

{Re-emit the Phase 3 Manual smoke checklist verbatim, with empty checkboxes:
  [ ] Open https://<deployed-url>/onboarding/key — confirm trust block...
  [ ] Click "Como gerar a chave?" — confirm modal opens...
  [ ] etc.
}

When you've worked through these, just say "smoke clean" or report any failure.
If anything fails, the next batch is on hold until we open a follow-up PR or
revert. If purely backend (no observable surface), this section reads:
"No manual smoke applicable for this story — verified via Phase 5 grep + CI."
```

The user's response to this prompt isn't gated by anything — `/bad-review` exits cleanly after Phase 5.5 emits the summary + checklist. It's a reminder, not a blocking gate. The next BAD batch starting before the user works through the checklist is fine; the asymmetry is that **the summary + checklist must be emitted every time**, even if the user habitually skips working through it. Discoverability over enforcement.

---

## Rules

1. **Never merge without the user's explicit [M] confirmation** at the end of Phase 3.
2. **Never reset local main to origin** when divergent — always rebase to preserve BAD's stranded commits.
3. **Treat PR body as decorative** — never cite it as evidence of what's in the PR. Always verify against the diff.
4. **If the rebase conflict is ambiguous** (not just the known "[ ] vs [x]" or "Status: ready-for-dev vs done" patterns) — HALT and ask the user to choose. Don't guess.
5. **If any subagent reports an issue rated "blocking"** — do not offer the Merge option. Present only [F] Fix first and [S] Stop.
6. **If CI is failing on the PR** at Phase 1 — report it and stop. The skill does not fix CI failures.
7. **If CI is pending / UNSTABLE / paused (including GitHub Actions disabled by billing limits)** — do not trust the PR body's test-count claim. Run the CI-pending guard in Phase 1 (local `npm test` in the PR worktree). Block the audit if it fails; proceed only if green, and note the source in the Phase 3 synthesis.

## Repo-specific context (edit when things change)

- Stack: Node.js >=22 ESM, Fastify v5, Postgres on Supabase Cloud EU, Pino, Resend
  (NO BullMQ — single in-process cron worker; NO SQLite/Drizzle — pg + raw SQL via `shared/db/`)
- Two services: `app/` (Fastify HTTP) + `worker/` (cron loop). Shared modules in `shared/`.
- Migrations: `supabase/migrations/` (NOT `db/migrations/` — Supabase CLI requirement).
  Append-only after commit — see Migration immutability guard (Phase 1 step 9).
- Mirakl: `marketplace.worten.pt`. Verify via Mirakl MCP server (per CLAUDE.md).
  Optional local probe: `scripts/mirakl-empirical-verify.js` (TBD — to be created at Story 3.x).
- pg Pool MUST include `ssl: { rejectUnauthorized: false }` (Supabase certs don't pass strict).
  Connection URL: prefer Session Pooler `postgresql://postgres.PROJECT_REF:[PASSWORD]@aws-0-REGION.pooler.supabase.com:5432/postgres`
  (IPv4, works from Docker/Coolify). Direct `db.PROJECT_REF.supabase.co:5432` is IPv6-only on
  newer Supabase projects and fails with ENOTFOUND inside containers. The "tenant not found"
  error with session pooler was caused by using username `postgres` instead of
  `postgres.PROJECT_REF` — confirmed fixed 2026-05-07.
- Current epic: track via `_bmad-output/implementation-artifacts/sprint-status.yaml`
- Authoritative planning: `_bmad-output/planning-artifacts/architecture-distillate/_index.md`
  (NOT `epics-distillate.md` — that's a single-file legacy reference; our distillate is split).
- Pre-emptive ATDD files for unimplemented stories: see `_bmad-output/implementation-artifacts/deferred-work.md`
- Known merge-race pattern: see `references/merge-procedure.md`
- Known forbidden patterns: see `references/mcp-forbidden-patterns.md`
