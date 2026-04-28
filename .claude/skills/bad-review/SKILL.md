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
2. Run `npm test` there — treat its output as authoritative, not the PR body's claim.
3. **If red:** promote to the same handling as "CI failing" (Rule 6) — report the failing tests and stop. Do not proceed to Phase 2.
4. **If green:** proceed to Phase 2 and note in the Phase 3 synthesis that the green-light came from a local run, not from GitHub Actions.
5. **If worktree missing** (unusual — only happens for externally-contributed PRs or after manual cleanup): halt and ask the user to check out the branch or wait for GitHub Actions. Do not skip the check.

This guard is cheap (~2 minutes of local test time) and closes the hole where a post-body revert breaks CI without anyone noticing.

### Live Smoke Evidence guard (Phase 1 step 7 — Mirakl-touching PRs only)

**Trigger:** `gh pr diff <N> --name-only` (from Phase 1 step 2) includes any
path matching `src/workers/mirakl/`. (This is the only Mirakl code path in
the repo; `src/lib/mirakl` does not exist and is not included in the trigger.)

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
\b(?:[a-zA-Z0-9_\-./]+\.(?:js|md|yaml|yml|json|css|html|sql|ts|tsx|sh|py)|(?:src|tests|public|scripts|_bmad-output|\.claude|\.agents)/[a-zA-Z0-9_\-./]+)\b
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

**Purpose of `PRIOR_DEFERRED_ITEMS`:** used in Phase 3 to (a) deduplicate observations — if an audit subagent surfaces a finding that's already recorded in deferred-work, label it as "previously deferred" rather than a new finding; (b) flag patterns — if the same kind of observation appears across two or more PRs in the same story-family, that's signal for a retro discussion. Without this step, fresh `/bad-review` sessions would re-log the same observation on every PR.

---

## Phase 2: Audit — 4 parallel subagents

Launch all four in a **single message** (parallel execution). Each is self-contained — subagents have no prior context. Use the Explore agent type unless otherwise noted.

### Subagent A: Code vs spec

```
You are auditing story implementation vs spec for DynamicPriceIdea
(a Mirakl marketplace repricing MVP in Node.js).

Story spec:
  {STORY_FILE}

Implementation files (may include none — e.g. a docs-only PR):
  {CODE_FILES}

For each numbered Acceptance Criteria (AC-1, AC-2, ...) in the spec:
  1. Locate where/if it is implemented in the code.
  2. Verify the implementation matches what the AC describes.
  3. Report one of: ✓ satisfied | ⚠️ deviation: <what differs> | ✗ missing

Also flag:
  - Any behavior in the code NOT required by spec (scope creep)
  - Any AC that is internally contradictory or contradicts Mirakl MCP
    (see references/mcp-forbidden-patterns.md in this skill)

Output format (use exactly this structure, stay under 400 words):

## AC Coverage
| AC  | Status | Note (if not ✓) |
|-----|--------|-----------------|
| AC-1| ✓      |                 |

## Scope creep
- <bullets or "none">

## Contradictions
- <bullets or "none">

## Verdict
Safe to merge / Blocking issues / Needs human judgment

Return only the report, no preamble.
```

### Subagent B: MCP alignment

```
You are checking Mirakl MCP alignment for DynamicPriceIdea.

Files to grep:
  {CODE_FILES}

The authoritative endpoint reference is in
  _bmad-output/planning-artifacts/epics-distillate.md
under the section "MCP-Verified Endpoint Reference".

Load the file at:
  .claude/skills/bad-review/references/mcp-forbidden-patterns.md

That file lists five known-stale patterns that cause silent production
failures. For each pattern, grep the target files.

Report:

## Forbidden patterns
| Pattern | Found? | File:line (if found) |
|---------|--------|----------------------|
| state === 'ACTIVE' | ✓ or ✗ | |
| product_ids: <with EANs> | | |
| o.channel_code / offer.channel_code | | |
| offer.price without offer.total_price alongside | | |
| Compare activeOffers.length to total_count | | |

## Correct-pattern confirmation
- Files using {offer.active, product_references=EAN|, pricing_channel_code, offer.total_price, allOffers.length===total_count}: list or "none applicable"

## New endpoints / unusual patterns worth live-probing
- Any endpoint name, param, or field accessed that is NOT documented in
  epics-distillate.md's MCP-Verified section. List or "none".

## Verdict
Aligned / Drift found / Needs live probe

Return only the report, stay under 300 words.
```

### Subagent C: Test quality

```
You are assessing test quality for a DynamicPriceIdea story PR.

Target test files (any combination of ATDD, .additional, .unit):
  {TEST_FILES}

Classify each test() call:
- BEHAVIORAL: calls the actual implementation with fixtures; asserts on
  return value, state change, or mock call args.
- KEYWORD-GREP: reads the implementation file as text; asserts
  src.includes('...') or regex patterns against source.
- SKELETON: asserts export existence, function type, class name only.

Report:

## Test classification
- N behavioral / M keyword-grep / K skeleton (total: N+M+K)
- Behavioral %: X%

## Critical gaps
List checks that SHOULD exist but don't, focused on:
- Security invariants (no api_key leak, no err.message in logs)
- Error paths (what if the dependency throws?)
- Edge cases (empty input, null, boundary values)
Use your judgement on what "critical" means for the specific code.

## Verdict
Strong (>=50% behavioral, no critical gaps) /
Acceptable (>=20% behavioral OR has .additional supplement) /
Weak (mostly keyword-grep, no behavioral supplement)

Stay under 300 words.
```

### Subagent D: PR body vs diff (hallucination check)

Use the `general-purpose` subagent type (needs gh CLI access beyond Explore).

```
You are auditing a BAD-generated PR body for hallucinations.

PR number: {PR_NUMBER}

Known pattern in this repo (see project memory feedback_bad_pipeline_trust.md):
BAD's Step 6 subagent sometimes fabricates filenames, table/column names,
config flags, and behaviors not in the actual diff. Your job is to catch this.

Steps:
1. Read the PR body via: gh pr view {PR_NUMBER} --json body
2. Get the actual diff via: gh pr diff {PR_NUMBER}
3. Extract specific claims from the body: filenames mentioned, tables, env
   vars, flags, behaviors (e.g. "retry", "attachments").
4. For each claim, check whether the diff supports it.

Report:

## Body claims vs diff
| Claim from PR body | Supported by diff? |
|--------------------|--------------------|
| "Adds src/foo.js"  | ✓                  |
| "report_items table" | ✗ (not in schema) |

## Summary
Body accuracy: Accurate / Partial / Hallucinated

Stay under 300 words. Only list claims that are specific (filenames, field
names, flags, explicit behaviors). Ignore general prose like "implements the
story" or "adds tests".
```

---

## Phase 3: Synthesize

Once all four subagents return, synthesize a short verdict in main context. Before writing the verdict, **cross-reference each subagent's findings against `PRIOR_DEFERRED_ITEMS`** (from Phase 1 step 6). For any new observation that duplicates a prior deferred item (same file:line, same root cause, same security-invariant class), don't re-surface it as a new finding — flag it as "previously deferred, still not fixed" in the recommendation. This prevents fresh `/bad-review` sessions from re-logging the same observation across every PR in a story-family.

```
# PR #{N} audit — {one-line verdict}

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

## Recommendation
{1-2 sentences — what to do next}

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

Then **HALT and wait for user confirmation** before doing anything destructive. Present the three options (or four, when deferred findings exist):

```
[M] Merge now — execute the safe-merge procedure
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
   grep -rE "state === 'ACTIVE'|product_ids: batchEans|o\.channel_code ===" src/workers/mirakl
   ```
   Expected: no matches (comments ok; only flag live param/field access).
4. **Run `npm test`** — report pass/fail counts. If a new test file landed in this PR that's not in `npm test`'s allowlist, note it and offer to add it (until the `skipUnlessImplExists()` helper is in place).
5. **CI state on main** — `gh run list --branch main --limit 1 --json conclusion,displayTitle`. Should be `success` or in_progress. If failure, show the user the link.
6. **Final report** — a compact status:

```
# PR #{N} merged and main verified

- Merged: ✓ at {timestamp}
- Local commits preserved: {N rebased / none}
- sprint-status: ✓ {story} = done
- MCP alignment: ✓ intact
- npm test: ✓ {passed/total} pass
- CI on main: ✓ {conclusion}
- Deferred findings: ✓ {N} appended to deferred-work.md  ← when Phase 4.5 ran with [Y]
                     OR  ⚠ {N} flagged but NOT captured (user skipped)  ← [N]
                     OR  (omit this line when no findings)

Main is clean. Ready for next batch.
```

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

- Stack: Node.js >=22 ESM, Fastify, BullMQ, SQLite/Drizzle, Resend
- Current epic: track via `_bmad-output/implementation-artifacts/sprint-status.yaml`
- Mirakl MCP: run `scripts/mcp-probe.js` for live verification against `marketplace.worten.pt`
- Pre-emptive ATDD files for unimplemented stories: see `_bmad-output/implementation-artifacts/deferred-work.md`
- Known merge-race pattern: see `references/merge-procedure.md`
- Known forbidden patterns: see `references/mcp-forbidden-patterns.md`
