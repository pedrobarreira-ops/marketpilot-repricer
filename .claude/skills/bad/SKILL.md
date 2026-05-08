---
name: bad
description: 'BMad Autonomous Development — orchestrates parallel story implementation pipelines. Builds a dependency graph, updates PR status from GitHub, picks stories from the backlog, and runs each through create → dev → review → PR in parallel — each story isolated in its own git worktree — using dedicated subagents with fresh context windows. Loops through the entire sprint plan in batches, with optional epic retrospective. Use when the user says "run BAD", "start autonomous development", "automate the sprint", "run the pipeline", "kick off the sprint", or "start the dev pipeline". Run /bad setup or /bad configure to install and configure the module.'
---

# BAD — BMad Autonomous Development

## On Activation

Check if `{project-root}/_bmad/config.yaml` contains a `bad` section. If not — or if the user passed `setup` or `configure` as an argument — load `./assets/module-setup.md` and complete registration before proceeding.

The `setup`/`configure` argument always triggers `./assets/module-setup.md`, even if the module is already registered (for reconfiguration).

After setup completes (or if config already exists), load the `bad` config and continue to Startup below.

You are a **coordinator**. You delegate every step to subagents via the **Agent tool**. You never read files, run git/gh commands, or write to disk yourself.

**Coordinator-only responsibilities:**
- Pick stories from subagent-reported data
- Call the Agent tool to spawn subagents (in parallel where allowed — multiple Agent tool calls in one message)
- Manage timers (CronCreate / CronDelete)
- Run Pre-Continuation Checks (requires session stdin JSON — coordinator only)
- Handle user input, print summaries, and send channel notifications

**Everything else** — file reads, git operations, gh commands, disk writes — happens inside Agent tool subagents with fresh context windows.

## Startup: Capture Channel Context

Before doing anything else, determine how to send notifications:

1. **Check for a connected channel** — look at the current conversation context:
   - If you see a `<channel source="telegram" chat_id="..." ...>` tag, save `NOTIFY_CHAT_ID` and `NOTIFY_SOURCE="telegram"`.
   - If another channel type is connected, save its equivalent identifier.
   - If no channel is connected, set `NOTIFY_SOURCE="terminal"`.

2. **Send the BAD started notification** using the [Notify Pattern](references/coordinator/pattern-notify.md):
   ```
   🤖 BAD started — building dependency graph...
   ```

Then proceed to Phase 0.

---

## Configuration

Load base values from the `bad` section of `_bmad/config.yaml` at startup. Then parse any `KEY=VALUE` overrides from arguments passed to `/bad` — args win over config. For any variable not in config or args, use the default below.

| Variable | Config Key | Default | Description |
|----------|-----------|---------|-------------|
| `MAX_PARALLEL_STORIES` | `max_parallel_stories` | `3` | Max stories to run in a single batch |
| `WORKTREE_BASE_PATH` | `worktree_base_path` | `.worktrees` | Root directory for git worktrees |
| `MODEL_STANDARD` | `model_standard` | `sonnet` | Model for all subagents except Step 5 (code review): Phase 0, Phase 1 Epic-Start, Steps 1–4 and 6–7, Phase 3 (merge + cleanup), Phase 4 (assessment + retrospective) |
| `MODEL_QUALITY` | `model_quality` | `opus` | Model for Step 5 (code review) |
| `RETRO_TIMER_SECONDS` | `retro_timer_seconds` | `600` | Auto-retrospective countdown after epic completion (10 min) |
| `WAIT_TIMER_SECONDS` | `wait_timer_seconds` | `3600` | Post-batch wait before re-checking PR status (1 hr) |
| `CONTEXT_COMPACTION_THRESHOLD` | `context_compaction_threshold` | `80` | Context window % at which to compact/summarise context |
| `STALE_TIMEOUT_MINUTES` | `stale_timeout_minutes` | `60` | Minutes of subagent inactivity before watchdog alerts (0 = disabled) |
| `TIMER_SUPPORT` | `timer_support` | `true` | When `true`, use native platform timers; when `false`, use prompt-based continuation |
| `MONITOR_SUPPORT` | `monitor_support` | `true` | When `true`, use the Monitor tool for CI and PR-merge polling; when `false`, fall back to manual polling loops (required for Bedrock/Vertex/Foundry) |
| `API_FIVE_HOUR_THRESHOLD` | `api_five_hour_threshold` | `80` | (Claude Code) 5-hour rate limit % that triggers a pause |
| `API_SEVEN_DAY_THRESHOLD` | `api_seven_day_threshold` | `95` | (Claude Code) 7-day rate limit % that triggers a pause |
| `API_USAGE_THRESHOLD` | `api_usage_threshold` | `80` | (Other harnesses) Generic API usage % that triggers a pause |
| `RUN_CI_LOCALLY` | `run_ci_locally` | `false` | When `true`, skip GitHub Actions and always run the local CI fallback |
| `AUTO_PR_MERGE` | `auto_pr_merge` | `false` | When `true`, auto-merge batch PRs sequentially (lowest → highest) before Phase 4 |

After resolving all values, print the active configuration so the user can confirm before Phase 0 begins:
```
⚙️ BAD config: MAX_PARALLEL_STORIES=3, RUN_CI_LOCALLY=false, AUTO_PR_MERGE=false, MODEL_STANDARD=sonnet, MODEL_QUALITY=opus, TIMER_SUPPORT=true, ...
```

---

## Pipeline

```
Phase 0: Build (or update) dependency graph  [subagent]
           └─ bmad-help maps story dependencies
           └─ GitHub updates PR merge status per story
           └─ git pull origin main
           └─ Reports: ready stories, epic completion status
  │
Phase 1: Discover stories  [coordinator logic]
           └─ Pick up to MAX_PARALLEL_STORIES from Phase 0 report
           └─ If new epic → Epic-Start Test Design [subagent, blocking]
           └─ If none ready → skip to Phase 4
  │
Phase 2: Run the pipeline  [subagents — stories parallel, steps sequential]
  ├─► Story A ──► Step 1 → Step 2 → Step 3 → Step 4 → Step 5 → Step 6 → Step 7
  ├─► Story B ──► Step 1 → Step 2 → Step 3 → Step 4 → Step 5 → Step 6 → Step 7
  └─► Story C ──► Step 1 → Step 2 → Step 3 → Step 4 → Step 5 → Step 6 → Step 7
  │
Phase 3: Auto-Merge Batch PRs  [subagents — sequential]
           └─ One subagent per story (lowest → highest story number)
           └─ Cleanup subagent for branch safety + git pull
  │
Phase 4: Batch Completion & Continuation
           └─ Print batch summary  [coordinator]
           └─ Epic completion check  [subagent]
           └─ Optional retrospective  [subagent]
           └─ Gate & Continue (WAIT_TIMER timer) → Phase 0 → Phase 1
```

---

## Phase 0: Build or Update the Dependency Graph

Before spawning the subagent, **create the full initial task list** using TaskCreate so the user can see the complete pipeline at a glance. Mark Phase 0 `in_progress`; all others start as `[ ]`. Apply the Phase 3 rule at creation time:

```
[in_progress] Phase 0: Dependency graph
[ ] Phase 1: Story selection
[ ] Phase 2: Step 1 — Create story
[ ] Phase 2: Step 2 — ATDD
[ ] Phase 2: Step 3 — Develop
[ ] Phase 2: Step 4 — Test review
[ ] Phase 2: Step 5 — Code review
[ ] Phase 2: Step 6 — PR + CI
[ ] Phase 2: Step 7 — PR review
[ ] Phase 3: Auto-merge                                      ← if AUTO_PR_MERGE=true
[completed] Phase 3: Auto-merge — skipped (AUTO_PR_MERGE=false)  ← if AUTO_PR_MERGE=false
[ ] Phase 4: Batch summary + continuation
```

Call the **Agent tool** with `model: MODEL_STANDARD`, `description: "Phase 0: dependency graph"`, and this prompt. The coordinator waits for the report.

```
Read `references/subagents/phase0-prompt.md` and follow its instructions exactly.
```

The coordinator uses the report to drive Phase 1. No coordinator-side file reads.

📣 **Notify** after Phase 0:
```
📊 Phase 0 complete
Ready: {N} stories — {comma-separated story numbers}
Blocked: {N} stories (if any)
```

After Phase 0 completes, **rebuild the task list in correct execution order** — tasks display in creation order, so delete and re-add to ensure Phase 2 story tasks appear before Phase 3 and Phase 4:

1. Mark `Phase 0: Dependency graph` → `completed`
2. Mark `Phase 1: Story selection` → `completed` (already done)
3. Delete all nine generic startup tasks: the seven `Phase 2: Step N` tasks, `Phase 3: Auto-merge`, and `Phase 4: Batch summary + continuation`
4. Re-add in execution order using TaskCreate:

```
[ ] Phase 1: Epic-Start Test Design            ← add once if new epic, before all story tasks
[ ] Phase 2 | Story {N}: Step 1 — Create story ← one set per selected story, all stories first
[ ] Phase 2 | Story {N}: Step 2 — ATDD
[ ] Phase 2 | Story {N}: Step 3 — Develop
[ ] Phase 2 | Story {N}: Step 4 — Test review
[ ] Phase 2 | Story {N}: Step 5 — Code review
[ ] Phase 2 | Story {N}: Step 6 — PR + CI
[ ] Phase 2 | Story {N}: Step 7 — PR review
                                               ← repeat for each story in the batch
[ ] Phase 3: Auto-merge                        ← if AUTO_PR_MERGE=true
[completed] Phase 3: Auto-merge — skipped (AUTO_PR_MERGE=false)  ← if AUTO_PR_MERGE=false
[ ] Phase 4: Batch summary + continuation
```

Update each story step task to `in_progress` when its subagent is spawned, and `completed` (or `failed`) when it reports back. Update Phase 3 and Phase 4 tasks similarly as they execute.

---

## Phase 1: Discover Stories

Pure coordinator logic — no file reads, no tool calls. All inputs come from the Phase 0 report.

1. From Phase 0's `ready_stories` report, select at most `MAX_PARALLEL_STORIES` stories.
   - **Default ordering:** pick from the lowest incomplete epic. Never pick a story from epic N if any story in epic N-1 (or earlier) is not yet `done`.
   - **Calendar-early exception:** a story Phase 0 marked `Ready to Work: ✅ Yes (calendar-early)` (i.e. its `ready_stories` entry has `calendar_early: true`) may be picked even though its numerical epic is not the lowest incomplete one — Phase 0 has already verified the override's `after_epic: K` gate. Calendar-early stories sharing the same `test_design_epic` may be batched together up to `MAX_PARALLEL_STORIES`. Do **not** mix a calendar-early story with stories from a different `test_design_epic`, or with stories from epic `K+1`, in the same batch.
2. **If no stories are ready** → report to the user which stories are blocked (from Phase 0 warnings), then jump to **Phase 4, Step 3 (Gate & Continue)**.
3. **Epic-Start trigger (durable-flag driven):** for each unique `test_design_epic` represented in the selected batch — read directly from `ready_stories[*].test_design_epic` in the Phase 0 report — look up `epic_test_design_status[N]` from the same report.
   - If `pending` → run **Epic-Start Test Design** for epic N (below) as a blocking subagent before Phase 2 begins. The subagent flips the row to `done` on completion.
   - If `done` → skip; scaffolds already exist on `main`.

   `CURRENT_EPIC` is retained only as a log-line variable; it no longer drives this trigger. The flag-based approach prevents Epic-Start from re-firing when the same epic is entered twice — e.g. Epic 9, entered first via the calendar-early slot for Stories 9.0/9.1, then chronologically for Stories 9.2-9.6 between Epic 8 and Epic 10.

> **Why epic ordering matters:** Stories in later epics build on earlier epics' code and product foundation. Starting epic 3 while epic 2 has open PRs risks merge conflicts and building on code that may still change. The calendar-early exception is project-local and bounded by an explicit `after_epic` gate in `sprint-status.yaml` — it doesn't relax the rule, just permits a controlled detour for foundational stories that 12+ later stories depend on.

### Epic-Start Test Design (`MODEL_STANDARD`)

Spawn before Phase 2 when starting a new epic (blocking — wait for completion before story pipelines begin):

```
You are the epic test design agent for {current_epic_name} (epic number {N}).
Working directory: {repo_root}. Auto-approve all tool calls (yolo mode).

Read `references/subagents/epic-start-test-design.md` and follow its instructions exactly.
```

**After Epic-Start Test Design completes — spawn an auto-review subagent (`MODEL_QUALITY` / Opus) BEFORE the user halt.**

The user is a non-developer and cannot meaningfully review test scaffolds directly. The halt remains (epic-wide test scaffolds are too consequential to skip a checkpoint), but what the user sees at the halt is a plain-language verdict from a fresh-context auditor — not raw test files.

### Auto-review subagent (`MODEL_QUALITY` — Opus)

Spawn after the test-design subagent reports success. This is judgment-heavy work — classifying coverage adequacy, identifying semantic gaps, distinguishing mechanical-fixable issues from spec-level ambiguity. Use Opus regardless of `MODEL_STANDARD`.

```
You are the Epic-Start Test Design auto-reviewer for {current_epic_name}.
Working directory: {repo_root}. Auto-approve all tool calls (yolo mode).

Iteration context (substituted by coordinator):
  ITERATION_NUMBER: {iteration_number}
  CURRENT_STORY: {current_story}
  PREVIOUS_ITERATION_SUMMARY: {previous_summary}  (omit when ITERATION_NUMBER is 0)

Read `references/subagents/epic-start-auto-review.md` and follow its instructions exactly.
```

### Halt with verdict-driven menu

After the auto-review returns, present the user with the **full auto-review report (verbatim — including the "For non-developer reader (TL;DR)" section at the top of the report)**, followed by the verdict-shaped menu. The TL;DR section gives the user the recommended action and reasoning before the menu options — Pedro can scan TL;DR alone for the call, or read the full report to verify.

**Strong verdict:**
```
{full auto-review report verbatim — includes TL;DR section at top}

[C] Continue to Phase 2  |  [S] Stop BAD
```

**Acceptable verdict (iteration 0 or 1):**
```
{full auto-review report verbatim — includes TL;DR section at top}

[C] Continue to Phase 2 (accept gaps as-is)
[Auto-Fix] Run a fix subagent on the listed gaps, then re-review
[S] Stop BAD
```

**Acceptable verdict (iteration 2 — final allowed):**
```
{full auto-review report verbatim — includes TL;DR section at top}

⚠ Iteration 2 reached. [Auto-Fix] is no longer offered (a 3rd auto-fix
attempt halts BAD). Choose [C] to ship with remaining gaps (Step 4 Test
Review per-story will catch them), or [S] to halt for manual investigation.

[C] Continue to Phase 2  |  [S] Stop BAD
```

**Weak verdict:**
```
⏸ Epic-Start Test Design — verdict: ❌ Weak

{auto-review summary}

Cannot proceed without fixes. The auto-review flagged {N} mechanical gaps
and {M} semantic gaps. {If M > 0: "Semantic gaps suggest spec-quality issue —
auto-fix may not converge. [S]top recommended; consider re-running
/bmad-create-story for the affected stories."}

[Auto-Fix] Run a fix subagent on the listed gaps, then re-review
[S] Stop BAD
```

Note that **Weak verdicts have no `[C] Continue` option** — proceeding past Weak is structurally not available. The user either fixes (auto or manual) or stops.

### [Auto-Fix] action — bounded retry

When the user picks `[Auto-Fix]`:

1. Spawn a fix subagent (`MODEL_STANDARD` — Sonnet; the work is mechanical patching, not judgment):
   ```
   You are the Epic-Start Test Design fix subagent for {current_epic_name}.
   Working directory: {repo_root}. Auto-approve all tool calls (yolo mode).

   Substitution for the reference file:
     MECHANICAL_GAPS_BLOCK: {paste the "Mechanical gaps (auto-fixable)" section from the auto-review}

   Read `references/subagents/epic-start-auto-fix.md` and follow its instructions exactly.
   ```

2. After the fix subagent reports, **re-run the auto-review** (Opus, fresh context). The new verdict is what the user sees.

3. **Bounded at 2 iterations.** Track `EPIC_START_AUTO_FIX_COUNT` (coordinator variable, initially 0; reset per epic). Increment on each [Auto-Fix] dispatch.
   - Iterations 1-2: present the new verdict's menu normally.
   - On the 3rd attempt: halt with `❌ Auto-fix didn't converge after 2 attempts — this is likely a spec-quality issue, not a coverage gap. [S]top recommended; the affected stories may need to be re-sharded via /bmad-create-story.` Menu offers only `[S] Stop BAD`.

### [C] / [S] / [FIRED] actions

- **[C] action:** Proceed to Phase 2 with current scaffolds. The user has accepted any remaining gaps. 📣 **Notify**: `✓ Epic-Start verdict {tier} accepted by user — proceeding to Phase 2.`
- **[S] action:** Stop BAD, print final summary, and 📣 **Notify**: `🛑 BAD stopped by user at Epic-Start review (verdict was {tier}).`

---

## Phase 2: Run the Pipeline

Launch all stories' Step 1 subagents **in a single message** (parallel). Each story's steps are **strictly sequential** — do not spawn step N+1 until step N reports success.

**Skip steps based on story status** (from Phase 0 report):

| Status          | Start from | Skip          |
|-----------------|------------|---------------|
| `backlog`       | Step 1     | nothing       |
| `ready-for-dev` | Step 2     | Step 1        |
| `atdd-done`     | Step 3     | Steps 1–2     |
| `in-progress`   | Step 3     | Steps 1–2     |
| `review`        | Step 4     | Steps 1–3     |
| `done`          | —          | all           |

**After each step — mandatory gate (never skip, even with parallel stories):** 📣 **Notify** the step result (formats below), then run **Pre-Continuation Checks** (`references/coordinator/gate-pre-continuation.md`). Only after all checks pass → spawn the next subagent.

📣 **Notify per step** as each step completes:
- Success: `✅ Story {number}: Step {N} — {step name}`
- Failure: `❌ Story {number}: Step {N} — {step name} failed — {brief error}`

Step names: Step 1 — Create, Step 2 — ATDD, Step 3 — Develop, Step 4 — Test review, Step 5 — Code review, Step 6 — PR + CI, Step 7 — PR review.

**On failure:** stop that story's pipeline. Report step, story, and error. Other stories continue.  
**Exception:** rate/usage limit failures → run Pre-Continuation Checks (which auto-pauses until reset) then retry.

**Hung subagents:** when `MONITOR_SUPPORT=true` and the activity log hook is installed (Step 4 of setup), use the [Watchdog Pattern](references/coordinator/pattern-watchdog.md) when spawning Steps 2, 3, 4, and 5 to detect stale agents.

**Sprint-Status Immutability Gate (applies to Steps 2 through 7):**

Only Step 1 (which runs in `{repo_root}` on main) and the coordinator on main
own per-story status transitions in sprint-status.yaml. The Epic-Start Test
Design subagent owns `epic_test_design.{N}` flips (top-level block, sibling
of `calendar_early_overrides:`). Steps 2 through 7 (which all run inside
feature worktrees) own NOTHING in sprint-status.yaml and MUST NOT modify it
— any flip from a feature worktree is committed to the feature branch and
collides with main's flips at merge time, causing rebase conflicts (Epic 2
retro Item 5).

Enforce by hash-snapshot around each, with a per-story file backup for Step 3 (Q1, Epic 5 retro):

Before spawning Step 2/3/4/5/6/7: compute `sha256sum _bmad-output/implementation-artifacts/sprint-status.yaml` → save as `STATUS_HASH_PRE`. **For Step 3 only:** also `cp _bmad-output/implementation-artifacts/sprint-status.yaml /tmp/bad-sprint-status-backup-{number}.yaml` so the coordinator can mechanically restore rather than halt — Step 3's vendored dev-story workflow has historically modified sprint-status despite wrapper guards.
After Step 2/3/4/5/6/7 reports success: recompute → save as `STATUS_HASH_POST`.
If `STATUS_HASH_POST != STATUS_HASH_PRE`:
- **Step 3 only**: restore from `/tmp/bad-sprint-status-backup-{number}.yaml`, log `↩ Story {N}: Step 3 sprint-status mutation reverted from backup (Q1)`, delete the backup file, continue to Step 4.
- **Step 2/4/5/6/7**: HALT this story's pipeline with: `❌ Story {number}: Step {N} modified sprint-status.yaml — state-machine violation. Steps 2-7 run in feature worktrees and MUST NOT touch sprint-status.yaml; only Step 1 (on main) and the coordinator own per-story flips. Investigate the stray write, revert the sprint-status change, and re-run.`

After Step 2/3/7 reports success and the gate passes, the coordinator performs the post-step flip on main (see "Coordinator-Side Sprint-Status Flips" below).

Rationale: avoids dual-flip rebase conflicts (PR #65 caused force-push). Step 1 is exempt — runs on main.

**Coordinator-Side Sprint-Status Flips:**

After each step reports success, the coordinator (running on main) performs
the corresponding sprint-status transition. These run sequentially in the
main worktree — never in a feature worktree — and produce a `chore(sprint-status)`
commit pushed directly to origin/main:

| After step | Flip story to | Commit message |
|---|---|---|
| Step 1 (Create) | `ready-for-dev` | (Step 1 itself does this — it runs on main) |
| Step 2 (ATDD) success | `atdd-done` | `chore(sprint-status): Story {N} → atdd-done` |
| Step 3 (Develop) success | `review` | `chore(sprint-status): Story {N} → review (dev-done)` |
| Step 7 (PR Review) success | `done` | `chore(sprint-status): Story {N} → done` |

For each: from main worktree, edit sprint-status.yaml, commit with the message above, push to origin/main. Steps 4, 5, 6 do not flip (they're intermediate quality checks within the dev → review transition).

**Q4 — Done-flip merge confirmation gate (Epic 5 retro):** Before flipping a story to `done` after Step 7 success, run `gh pr view {N} --json mergedAt --jq .mergedAt`. If the result is empty/null, do NOT flip — leave the story at `review` and emit `⏸ Story {N}: PR #{N} not yet merged on GitHub (Step 7 success ≠ merged); leaving at review. Phase 0 reconciliation will retry next batch.` Story 5.1's done-flip raced PR #81's actual merge on 2026-05-08 (commit `66b947a` rolled back to `fe95a9d` review) — Step 7 exit success is not equivalent to GitHub-confirmed merge.

### Step 1: Create Story (`MODEL_STANDARD`)

Spawn with model `MODEL_STANDARD` (yolo mode). Substitute `{base_branch}` from the
`base_branch` field of this story's `ready_stories` entry in the Phase 0 report
(defaults to `main`; will be an upstream bundle sibling's PR branch when the
atomicity-bundle exception fired in Phase 0):
```
You are the Step 1 story creator for story {number}-{short_description}.
Working directory: {repo_root}. WORKTREE_BASE_PATH is `{WORKTREE_BASE_PATH}` (used to construct the worktree path).
The worktree base branch is `{base_branch}` — fork the new worktree from this
branch. For non-bundle stories this is `main`; for bundle-stacked dispatch (per
Phase 0's atomicity-bundle exception) it is the upstream bundle sibling's PR
branch (e.g. `story-5.1-master-cron-dispatcher-...`), so the new story builds on
the upstream's unmerged code.
Auto-approve all tool calls (yolo mode).

Read `references/subagents/step1-create-story.md` and follow its instructions exactly.
```

### Step 2: ATDD (`MODEL_STANDARD`)

Spawn with model `MODEL_STANDARD` (yolo mode):
```
You are the Step 2 ATDD agent for story {number}-{short_description}.
Working directory: {repo_root}/{WORKTREE_BASE_PATH}/story-{number}-{short_description}.
Auto-approve all tool calls (yolo mode).

Read `references/subagents/step2-atdd.md` and follow its instructions exactly.
```

### Step 3: Develop Story (`MODEL_STANDARD`)

**Before Step 3 — Mirakl MCP Gate (Mirakl stories only):**

Check if this story touches Mirakl: look for "mirakl" (case-insensitive) in `{short_description}`, or verify the story spec file references `shared/mirakl/`.

If the story touches Mirakl:
1. Use ToolSearch with query `"mcp__mirakl"` to probe availability. **Filter out tool names matching `/authenticate/i`** — `mcp__mirakl__authenticate` and `mcp__mirakl__complete_authentication` exist as deferred tools even before the MCP is authenticated (they ARE the auth handshake) so unfiltered counts produce false positives. If the filtered count is > 0 (i.e., at least one non-auth Mirakl data tool exists), the MCP is authenticated and active — proceed to dispatch Step 3 normally. If filtered count == 0 (only auth tools present, OR no results at all), the MCP is disabled or pending authentication — halt as below. Story 6.1 dispatch on 2026-05-08 hit this false positive: gate said "active ✅" while MCP was pending auth, Step 3 began writing training-data-guessed PRI01 endpoint code before it was caught and reset.
2. On halt, print:
   ```
   ⚠️  Mirakl MCP is unavailable (disabled OR pending authentication).
   Story {number} ({short_description}) requires live Mirakl MCP verification during development.
   Without it, Step 3 will guess endpoint behaviour from training data — exactly the failure mode CLAUDE.md forbids.

   Enable it: Claude Code Settings → MCP → mirakl → toggle on. If toggled but pending auth, complete the OAuth flow via `mcp__mirakl__authenticate` first.
   Verify: ToolSearch for "mcp__mirakl" should return data tools (e.g. mcp__mirakl__list_offers) beyond just the two authenticate tools.

   [C] Retry — re-test MCP and dispatch Step 3
   [S] Stop BAD
   ```
   📣 **Notify:** `⚠️ Mirakl MCP unavailable — story {number} needs it. Enable/authenticate and type [C].`
3. On **[C]**: re-run the ToolSearch + filter check. If filtered count > 0, dispatch Step 3. If still 0, re-print the message and wait again.
4. On **[S]**: halt BAD. Print `BAD stopped — enable Mirakl MCP and re-run /bad.` 📣 **Notify:** `🛑 BAD stopped — Mirakl MCP required.`

Spawn with model `MODEL_STANDARD` (yolo mode):
```
You are the Step 3 developer for story {number}-{short_description}.
Working directory: {repo_root}/{WORKTREE_BASE_PATH}/story-{number}-{short_description}.
Auto-approve all tool calls (yolo mode).

Read `references/subagents/step3-develop.md` and follow its instructions exactly.
```

**After Step 3 — Uncommitted Files Gate (HALT if working tree dirty):**
Run `git -C {worktree_path} status --porcelain`. If output is non-empty, HALT
this story's pipeline with error:
`❌ Story {number}: Step 3 left uncommitted files in {worktree_path}. Dev
agent may have truncated mid-implementation. Resolution: commit the changes,
stash them explicitly, or dismiss with SKIP_CLEAN_TREE_GATE=true if intended.
Do NOT spawn Step 4 against a dirty tree.`
Rationale: dev agents have previously truncated mid-implementation, leaving
changes only on disk. Without this gate, Step 4 reviews a partial tree and
the truncation ships silently.

### Step 4: Test Review (`MODEL_QUALITY`)

Test review is judgment-heavy work — classifying behavioral vs keyword-grep coverage, identifying critical gaps, distinguishing acceptable supplements from regressions. Use `MODEL_QUALITY` (Opus) for all stories, not just critical-path. Model promotion from previous spec where this defaulted to `MODEL_STANDARD`.

Spawn with model `MODEL_QUALITY` (yolo mode):
```
You are the Step 4 test reviewer for story {number}-{short_description}.
Working directory: {repo_root}/{WORKTREE_BASE_PATH}/story-{number}-{short_description}.
Auto-approve all tool calls (yolo mode).

Read `references/subagents/step4-test-review.md` and follow its instructions exactly.
```

### Step 5: Code Review (`MODEL_QUALITY`)

**Before spawning Step 5 — Worker/Critical-Path Opus Gate (HALT if downgraded):**
Run `git -C {worktree_path} diff main --name-only`. If any output line starts
with any of:
  - `worker/src/`              (worker code: cron, engine, safety, jobs)
  - `app/src/routes/`          (Fastify routes — public + admin surfaces)
  - `app/src/middleware/`      (auth, RLS, error handling)
  - `shared/mirakl/`           (Mirakl API client, request/response shaping)
  - `shared/audit/`            (audit-log writer SSoT)
  - `shared/state/`            (cron_state machine SSoT)
  - `shared/money/`            (price math SSoT — float-math footgun zone)
  - `shared/crypto/`           (envelope encryption + master-key loader)
  - `supabase/migrations/`     (schema changes — multi-env divergence risk)
then `MODEL_QUALITY` MUST resolve to `claude-opus-4-7` (Opus). If it resolves
to anything else, HALT this story's pipeline with error:
`❌ Story {number}: Critical-path PR requires Opus at Step 5 — MODEL_QUALITY
is configured as {value}. Override with MODEL_QUALITY=opus and re-run.`
Rationale: prior worker-path runs caught 3/3 defects Sonnet missed at Step 5.
The path list above covers our atomicity bundles, the 11 SSoT modules, and
the migration-immutability surface — each is a multi-day-incident class.

Spawn with model `MODEL_QUALITY` (yolo mode):
```
You are the Step 5 code reviewer for story {number}-{short_description}.
Working directory: {repo_root}/{WORKTREE_BASE_PATH}/story-{number}-{short_description}.
Auto-approve all tool calls (yolo mode).

Read `references/subagents/step5-code-review.md` and follow its instructions exactly.
```

### Step 6: PR & CI (`MODEL_STANDARD`)

Spawn with model `MODEL_STANDARD` (yolo mode):
```
You are the Step 6 PR and CI agent for story {number}-{short_description}.
Working directory: {repo_root}/{WORKTREE_BASE_PATH}/story-{number}-{short_description}.
Auto-approve all tool calls (yolo mode).

Read `references/subagents/step6-pr-ci.md` and follow its instructions exactly.
```

### Step 7: PR Code Review (`MODEL_STANDARD` default, `MODEL_QUALITY` on critical-path)

**Before spawning Step 7 — Worker/Critical-Path Opus Gate (mirrors Step 5):**
Run `git -C {worktree_path} diff main --name-only`. If any output line starts
with any of:
  - `worker/src/`              (worker code: cron, engine, safety, jobs)
  - `app/src/routes/`          (Fastify routes — public + admin surfaces)
  - `app/src/middleware/`      (auth, RLS, error handling)
  - `shared/mirakl/`           (Mirakl API client, request/response shaping)
  - `shared/audit/`            (audit-log writer SSoT)
  - `shared/state/`            (cron_state machine SSoT)
  - `shared/money/`            (price math SSoT — float-math footgun zone)
  - `shared/crypto/`           (envelope encryption + master-key loader)
  - `supabase/migrations/`     (schema changes — multi-env divergence risk)
then promote Step 7 to `MODEL_QUALITY` (Opus) for this story. Otherwise use
`MODEL_STANDARD` (Sonnet) — non-critical PR reviews don't need Opus.

Rationale: Step 7 reviews the PR diff (via `gh pr diff`) and applies fixes.
The same critical-path classes that warrant Opus at Step 5 also warrant Opus
at Step 7 — review depth is review depth, regardless of which step does it.
The gate is per-story, not configuration-time, so an off-path PR runs Sonnet
even when MODEL_QUALITY is set.

Spawn with model `MODEL_STANDARD` (or `MODEL_QUALITY` per the gate above), yolo mode:
```
You are the Step 7 PR code reviewer for story {number}-{short_description}.
Working directory: {repo_root}/{WORKTREE_BASE_PATH}/story-{number}-{short_description}.
Auto-approve all tool calls (yolo mode).

Read `references/subagents/step7-pr-review.md` and follow its instructions exactly.
```

---

## Phase 3: Auto-Merge Batch PRs (when AUTO_PR_MERGE=true)

After all batch stories complete Phase 2, merge every successful story's PR into `main` — one subagent per story, **sequentially** (lowest story number first).

> **Why sequential:** Merging lowest-first ensures each subsequent merge rebases against a main that already contains its predecessors — keeping conflict resolution incremental and predictable.

**Steps:**

1. Collect all stories from the current batch that reached Step 6 successfully (have a PR). Sort ascending by story number.
2. **Merge-block filter (atomicity bundles)** — spawn a quick subagent (`MODEL_STANDARD`) to read `_bmad-output/implementation-artifacts/sprint-status.yaml` and extract:
   - The `merge_blocks:` top-level block (may be absent or empty — that's fine).
   - The `development_status:` map (for `until_story` status lookups).

   For each candidate story from step 1:
   - If the story key appears in `merge_blocks`, look up its `until_story` value and check that story's status in `development_status:`.
   - If `until_story` status is `done`, the candidate is mergeable — keep it in the list.
   - If `until_story` status is anything else (`backlog`, `ready-for-dev`, `atdd-done`, `in-progress`, `review`), REMOVE the candidate from the auto-merge list. Leave its PR open. Log: `⏸ Story {N} bundle-blocked by {until_story} (currently {status}) — leaving PR open. Will auto-merge in a future batch once the gate story lands.`
   - 📣 **Notify** for each blocked story: `⏸ Story {N}: bundle-{bundle} blocked by {until_story} — PR remains open`.

   This filter MUST run before any merge subagent spawns. Bundle invariants are hard — a "Step 6 succeeded, ready to merge" story can still be merge-blocked.

3. For each remaining (mergeable) story **sequentially** (wait for each to complete before starting the next):
   - Pull latest main at the repo root: spawn a quick subagent or include in the merge subagent.
   - Spawn a `MODEL_STANDARD` subagent (yolo mode) with the instructions from `references/subagents/phase3-merge.md`.
   - Run Pre-Continuation Checks after the subagent completes. If it fails (unresolvable conflict, CI blocking), report the error and continue to the next story.
4. Print a merge summary (coordinator formats from subagent reports), and include any bundle-blocked rows from step 2 with a `Blocked` outcome:
   ```
   Auto-Merge Results:
   Story   | PR    | Outcome
   --------|-------|--------
   6.1     | #142  | Merged ✅
   6.2     | #143  | Merged ✅ (conflict resolved: src/foo.ts)
   6.3     | #144  | Failed ❌ (CI blocking — manual merge required)
   7.2     | #145  | ⏸ Blocked — bundle-C, awaiting 7.8
   ```
📣 **Notify** after all merges are processed (coordinator formats from subagent reports):
```
🔀 Auto-merge complete
{story}: ✅ PR #{pr} | {story}: ✅ PR #{pr} (conflict resolved) | {story}: ❌ manual merge needed | {story}: ⏸ blocked
```

5. Spawn a **cleanup subagent** (`MODEL_STANDARD`, yolo mode):
   ```
   Post-merge cleanup. Auto-approve all tool calls (yolo mode).
   Read `references/subagents/phase3-cleanup.md` and follow its instructions exactly.
   ```

---

## Phase 4: Batch Completion & Continuation

### Step 1: Print Batch Summary

Coordinator prints immediately — no file reads, formats from Phase 2 step results:

```
Story   | Step 1 | Step 2 | Step 3 | Step 4 | Step 5 | Step 6 | Step 7 | Result
--------|--------|--------|--------|--------|--------|--------|--------|-------
9.1     |   OK   |   OK   |   OK   |   OK   |   OK   |   OK   |   OK   | PR #142
9.2     |   OK   |   OK   |   OK   |  FAIL  |   --   |   --   |   --   | Test review failed: ...
9.3     |   OK   |   OK   |   OK   |   OK   |   OK   |   OK   |   OK   | PR #143
```

If arriving from Phase 1 with no ready stories:
```
No stories ready to work on.
Blocked stories: {from Phase 0 report}
```

📣 **Notify** with the batch summary (same content, condensed to one line per story):
```
📦 Batch complete — {N} stories
{number} ✅ PR #{pr} | {number} ❌ Step {N} | ...
```
Or if no stories were ready: `⏸ No stories ready — waiting for PRs to merge`

### Step 2: Check for Epic Completion

From Phase 2 results, collect the batch stories and their PR numbers (e.g. `8.1 → #101, 8.2 → #102`). Pass these as `BATCH_STORIES_WITH_PRS` in the assessment prompt below.

Spawn an **assessment subagent** (`MODEL_STANDARD`, yolo mode):
```
Epic completion assessment. Auto-approve all tool calls (yolo mode).
BATCH_STORIES_WITH_PRS: {coordinator substitutes: "story → #PR" pairs from this batch, one per line}

Read `references/subagents/phase4-assessment.md` and follow its instructions exactly.
```

Using the assessment report:

**If `current_epic_merged = true`:**
1. Print: `🎉 Epic {current_epic_name} is complete! Starting retrospective countdown ({RETRO_TIMER_SECONDS ÷ 60} minutes)...`

   📣 **Notify:** `🎉 Epic {current_epic_name} complete! Running retrospective in {RETRO_TIMER_SECONDS ÷ 60} min...`
2. Start a timer using the **[Timer Pattern](references/coordinator/pattern-timer.md)** with:
   - **Duration:** `RETRO_TIMER_SECONDS`
   - **Fire prompt:** `"BAD_RETRO_TIMER_FIRED — The retrospective countdown has elapsed. Auto-run the retrospective: spawn a MODEL_STANDARD subagent (yolo mode) to run /bmad-retrospective, accept all changes. Run Pre-Continuation Checks after it completes, then proceed to Phase 4 Step 3."`
   - **[C] label:** `Run retrospective now`
   - **[S] label:** `Skip retrospective`
   - **[X] label:** `Stop BAD`
   - **[C] / FIRED action:** Spawn MODEL_STANDARD subagent (yolo mode) to run `/bmad-retrospective`. Accept all changes. Run Pre-Continuation Checks after.
   - **[S] action:** Skip retrospective.
   - **[X] action:** `CronDelete(JOB_ID)`, stop BAD, print final summary, and 📣 **Notify:** `🛑 BAD stopped by user.`
3. Proceed to Step 3 after the retrospective decision resolves.

### Step 3: Gate & Continue

**Pre-step: Phase 4.5 must have resolved.** Before starting any timer / monitor / wait in this step, ensure the Phase 4.5 Pedro Integration Test Gate (defined below) has fired and resolved with `[P]` (or was a no-op because no batch story was tagged `integration_test_required: true`). If Phase 4.5 resolved with `[F]` BAD has already halted; this step does not run. If `[K]` was offered and selected, this step runs as normal but the skip is logged to `deferred-work.md`.

Using the assessment report from Step 2, follow the applicable branch:

**Branch A — All epics complete (`all_epics_complete = true`):**
```
🏁 All epics are complete — sprint is done! BAD is stopping.
```
📣 **Notify:** `🏁 Sprint complete — all epics done! BAD is stopping.`

**Branch B — More work remains:**

1. Print a status line:
   - `current_epic_merged = true` (epic fully landed): `✅ Epic {current_epic_name} complete. Next up: Epic {next_epic_name} ({stories_remaining} stories remaining).`
   - `current_epic_prs_open = true` (all stories have PRs, waiting for merges): `⏸ Epic {current_epic_name} in review — {N} PR(s) open: {list PR numbers}.`
   - Otherwise (more stories to develop in current epic): `✅ Batch complete.`

2. Halt BAD with the option to run bad-review inline. Print:
   ```
   ⏸ BAD halted — batch complete.

   Open PRs: {list — PR #N (Story X.Y) for each unmerged PR, or "none" if all merged}

   How do you want to proceed?

   [R] Run /bad-review on the NEWEST open PR only (recommended)
       Spawns bad-review on PR #{newest-PR-number} only — the one BAD just
       shipped this batch. Older open PRs were already audited in prior
       batches and have no new commits since, so re-auditing them costs
       Opus tokens for no new findings.
   [A] Audit ALL open PRs
       Use only if prior audits are stale OR you want fresh cross-PR checks.
       Iterates each open PR sequentially (~5-10 min Opus + ~100k tokens per PR).
   [S] Stop BAD
       Don't run bad-review. You can run it manually in a new session.
   ```
   📣 **Notify:** `⏸ BAD halted — batch complete. [R] audit newest, [A] audit all, or [S] stop.`

   If no open PRs (`current_epic_merged = true` and no leftover PRs from earlier batches): omit the `[R]` and `[A]` options and just print `Run /bad in a new session to start the next batch.` Then stop BAD.

3. **[R] / [A] handler — Inline bad-review with fresh context:**

   - **[R]**: target the NEWEST open PR ONLY (the one this batch just shipped — highest PR number among the open list, OR the one whose story key matches the just-completed Phase 2 batch). Run 3a + 3b + 3c on that one PR, then go to 3d. Do NOT loop to other open PRs even if [N] is chosen.
   - **[A]**: iterate every open PR sequentially. Run 3a + 3b + 3c on the first, then [N] / [M]'s success path loops back to 3a for the next PR. After all open PRs processed, go to 3d.

   **3a. Spawn the audit subagent** (`general-purpose` type — needs `Agent` tool to spawn its own audit subagents):
   ```
   Agent type: general-purpose
   Description: bad-review audit on PR #{N}

   Prompt:
   You are running an audit on PR #{N}.

   Substitutions for the reference file:
     {N}: {PR-number}

   Read `references/subagents/phase4-r-bad-review.md` and follow its instructions exactly.
   ```

   **3b. Print the returned verdict report verbatim**, then halt with:
   ```
   What's your call on PR #{N}?

   [M] Merge now — execute bad-review Phase 4 (safe-merge) and Phase 5 (post-merge verify)
   [F] Fix first — halt; you'll fix issues and re-run later
   [S] Stop — read the report and merge manually later
   [N] Skip this PR — leave it open, move to the next PR (if any)
   ```
   📣 **Notify:** `📋 bad-review verdict ready for PR #{N} — awaiting your call`.

   **3c. Action handlers:**

   - **[M]:** Spawn a `general-purpose` subagent to execute Phase 4 + Phase 4.5 (deferred capture, only if the verdict's "Deferred findings" section was non-empty) + Phase 5:
     ```
     Description: bad-review merge + verify PR #{N}

     Prompt:
     You are merging and verifying PR #{N}.

     Substitutions for the reference file:
       {N}: {PR-number}
       DEFERRED_FINDINGS_BLOCK: {paste the "Deferred findings" section from the audit verdict, or "(none — skip Phase 4.5)" if the verdict had no deferred findings}
       {YYYY-MM-DD}: {today's date}

     Read `references/subagents/phase4-m-merge-verify.md` and follow its instructions exactly.
     ```
     After the subagent returns, print its confirmation. Then run Phase 5.5 post-merge smoke automation:

     **Phase 5.5a — Migration analysis.** Before spawning, run in the coordinator:
     ```bash
     gh pr diff {N} --name-only | grep "supabase/migrations/"
     ```
     Capture the output as `MIGRATION_FILES_LIST` (may be empty). This data-grounds the
     file list — Phase 5.5a receives it directly rather than re-querying GitHub with `{N}`,
     which can be stale in a sequential multi-PR loop (root cause of PR #73 migration miss).

     Spawn `MODEL_STANDARD` (yolo mode):
     ```
     You are the Phase 5.5 migration analyst for PR #{N}.
     {N}: {PR-number}
     MIGRATION_FILES_LIST:
     {MIGRATION_FILES_LIST — paste verbatim, or "(none)" if empty}

     Read `references/subagents/phase4-post-merge-smoke-analyze.md` and follow its instructions exactly.
     ```

     Read the subagent's output:

     - If `requires_confirmation: true` — halt and print:
       ```
       ⚠️  Destructive migration detected in PR #{N}.

       {dangerous_ops_description from subagent output}

       This cannot be undone once applied to the database.

       [C] Confirmed — push migrations and run smoke tests
       [S] Stop — do NOT push migrations
       ```
       📣 **Notify:** `⚠️ Destructive migration in PR #{N} — your confirmation required.`
       On **[S]**: halt. Print `BAD stopped — migrations NOT pushed. Push manually when ready.`
       On **[C]**: proceed to Phase 5.5b.

     - If `requires_confirmation: false` — proceed to Phase 5.5b immediately.

     **Phase 5.5b — Push + verify.** Spawn `MODEL_STANDARD` (yolo mode):
     ```
     You are the Phase 5.5 push and verify subagent for PR #{N}.
     {N}: {PR-number}
     {repo_root}: {repo_root}

     Read `references/subagents/phase4-post-merge-smoke.md` and follow its instructions exactly.
     ```

     Print the subagent's pass/fail report verbatim. If Overall is ⚠️ FAIL, also print:
     ```
     Post-merge smoke failed — investigate before running the next /bad batch.
     ```

   - **[F]** or **[S]:** halt without merging. Print `BAD halted — PR #{N} left open. Address findings, then re-run /bad in a new session.` 📣 **Notify:** `⏸ BAD halted — {action} on PR #{N}`. Do NOT proceed to remaining open PRs.

   - **[N]:** print `Skipping PR #{N} — leaving open.` Continue to the next open PR (loop back to 3a).

   **3d. After all open PRs processed:**
   ```
   ✅ All open PRs reviewed. Run /bad in a new session to start the next batch.
   ```
   📣 **Notify:** `✅ Batch fully reviewed — ready for next /bad run`. BAD stops.

4. **[S] handler:** halt without running bad-review. Print:
   ```
   BAD stopped. Run /bad-review manually in a new session, then /bad
   for the next batch.
   ```
   📣 **Notify:** `🛑 BAD stopped by user`.

BAD does not auto-restart in any branch. No timer is set. Pedro always starts the next batch by running `/bad` in a new session.

---

## Phase 4.5: Integration Test Gate (automated)

Discipline checkpoint that fires between Phase 4 Step 2 (Epic Completion Check) and Phase 4 Step 3 (Gate & Continue). Captures the systemic discovery from Epic 1 retro: library empirical-contract violations cannot be caught by static review — only by running tests against real infrastructure. BAD runs the tests automatically; Pedro is only interrupted if Supabase is unreachable and won't auto-start, or if tests fail.

### Step 1: Determine the batch

Spawn a quick subagent (`MODEL_STANDARD`, yolo mode) with this prompt:
```
BATCH_STORIES: {coordinator substitutes the current batch list}
BATCH_STORIES_WITH_PRS: {coordinator substitutes from Phase 4 Step 2}

Read `references/subagents/phase4-5-batch-determine.md` and follow its instructions exactly.
```

### Step 2: Three branches

**Branch A — `INTEGRATION_TEST_BATCH` empty:**
```
📋 Phase 4.5 — no stories tagged integration_test_required in this batch.
Proceeding to Phase 4 Step 3.
```
No halt. Coordinator continues to Step 3 immediately.

**Branch B — `INTEGRATION_TEST_BATCH` non-empty AND `SCRIPT_EXISTS = true`:**

BAD runs the tests automatically using the following procedure (no Pedro halt unless a blocker is hit):

**Sub-step B1 — Supabase health check:**
Run `npx supabase status 2>&1` from REPO_ROOT. Inspect output:
- If output contains `stopped` or `not running`, or if the command errors → Supabase is down. Proceed to B2.
- Otherwise → Supabase is running. Skip to B3.

**Sub-step B2 — Auto-start Supabase:**
Run `npx supabase start` from REPO_ROOT (allow up to 120 seconds). 📣 **Notify:** `⏳ Phase 4.5: Supabase not running — attempting auto-start...`
- If start succeeds (exit 0) → proceed to B3.
- If start fails or times out → halt and ask Pedro:
  ```
  ⚠ Phase 4.5 — Supabase could not be auto-started.

  Stories requiring integration tests: {numbered list}

  Please start Supabase manually (`npx supabase start`) then report:

  [R] Ready — Supabase is now running, proceed with tests
  [S] Stop BAD entirely
  ```
  📣 **Notify:** `⚠ Phase 4.5 blocked — Supabase start failed, waiting for Pedro`.
  On `[R]`: proceed to B3. On `[S]`: stop BAD.

**Sub-step B3 — Reset DB + run tests:**

First, reset the local Supabase DB from the worktree so all pending migrations are applied:
```
cd "{worktree_path}" && npx supabase db reset
```
This ensures any migration added by the batch stories is applied before the test run.
If the reset fails (non-zero exit), halt:
```
❌ Phase 4.5 — supabase db reset failed.

Stories tested: {list}
Error output: {trimmed to ≤20 lines}

Fix the migration issue, then re-run BAD.

[S] Stop BAD entirely
```

Then derive and run the test command from `TEST_INTEGRATION_CMD`:
- Take the raw script string from package.json.
- Replace `--env-file=.env.test` with `--env-file="{REPO_ROOT}/.env.test"` (absolute path so it works from any worktree).
- Run this modified command from the worktree of the first tagged story (the worktree contains the latest test files).

Parse exit code and output:
- Exit 0, `fail 0` in output → **auto-pass**: log `✅ Phase 4.5 auto-passed: {N} stories, all tests green ({pass} tests)`. Proceed to Phase 4 Step 3 immediately — no halt. 📣 **Notify:** `✅ Integration tests passed — proceeding`.
- Exit non-zero OR `fail N` in output → **auto-fail**: collect the failure lines and halt:
  ```
  ❌ Phase 4.5 — Integration tests failed.

  Stories tested: {list}
  Failures:
  {failing test names and error output, trimmed to ≤40 lines}

  PRs left open. Investigate failures before re-running BAD.

  [S] Stop BAD entirely
  ```
  📣 **Notify:** `❌ Integration tests failed — BAD halted at Phase 4.5`.
  Do NOT auto-recover. Pedro investigates, fixes, then re-runs `/bad`.

**Branch C — `INTEGRATION_TEST_BATCH` non-empty AND `SCRIPT_EXISTS = false`:**

Item 0 (test-harness chore PR) hasn't landed yet. Halt with this message:
```
📋 Phase 4.5 — Integration Test Gate (script not yet available)

The following stories in this batch carry integration_test_required: true:
{numbered list with reasons}

⚠ `npm run test:integration` does not exist in package.json yet —
Item 0 of the Epic 1 retro (test-harness chore PR) has not landed.
The gate cannot run this batch.

[K] Skip this batch — Item 0 not yet landed; will be audit-logged.
[S] Stop BAD entirely (recommended if you want to land Item 0 first)
```

📣 **Notify:** `⚠ Integration test gate fired but script unavailable — Item 0 dependency`.

### Step 3: Action handlers

- **[R]** (Branch B Sub-step B2 only): Supabase confirmed running by Pedro. Proceed to B3.

- **[K]** (Branch C only): log `Phase 4.5 SKIPPED — npm run test:integration unavailable; Item 0 not yet landed`. Append to `_bmad-output/implementation-artifacts/deferred-work.md` under a new section:
  ```
  ## Phase 4.5 skipped — Item 0 dependency ({ISO-date})

  Batch: {batch_id} — {N} stories tagged integration_test_required:
  - Story {N} (PR #{pr}) — {reason}

  npm run test:integration script did not exist at gate fire-time.
  Bypass acceptable until Item 0 lands; once it does, [K] is no longer offered.
  ```
  Then proceed to Phase 4 Step 3.

- **[S]**: Stop BAD entirely. Print final summary. 📣 **Notify:** `🛑 BAD stopped at Phase 4.5 by user`.

### Rationale

Library contracts (pg Pool conditional-SSL, Supabase auth.users DELETE semantics, Stripe webhook idempotency, Mirakl PRI01 partial-success, etc.) are differences between documented behavior and actual library behavior. They cannot be caught by reading code or tests in isolation — only by running tests against the real library against a real Supabase / Stripe / Mirakl. Phase 4.5 is the harness that forces this run before any Mirakl/Stripe/Supabase-touching PR merges.

Untagged stories pay zero cost — Branch A exits immediately with a one-line notice. The frequency of `true` tags naturally drops over time as Library Empirical Contracts accumulate (`_bmad-output/planning-artifacts/architecture-distillate/_index.md` table) — once a contract is documented and the test exists, future stories that touch the same library inherit the prior test coverage and don't need a fresh integration run.

---

## Notify Pattern

Read `references/coordinator/pattern-notify.md` whenever a `📣 Notify:` callout appears. It covers Telegram and terminal output.

---

## Timer Pattern

Read `references/coordinator/pattern-timer.md` when instructed to start a timer. It covers both `TIMER_SUPPORT=true` (CronCreate) and `TIMER_SUPPORT=false` (prompt-based) paths.

---

## Monitor Pattern

Read `references/coordinator/pattern-monitor.md` when `MONITOR_SUPPORT=true`. It covers CI status polling (Step 6) and PR-merge watching (Phase 4 Branch B), plus the `MONITOR_SUPPORT=false` fallback for each.

---

## Watchdog Pattern

Read `references/coordinator/pattern-watchdog.md` when `MONITOR_SUPPORT=true` and the activity log hook is installed (Step 4 of setup). Use it before spawning long-running Phase 2 subagents (Steps 2, 3, 4, 5) to detect hung agents via activity log monitoring.

---

## gh → curl Fallback Pattern

Read `references/coordinator/pattern-gh-curl-fallback.md` when any `gh` command fails (TLS error, sandbox restriction, spending limit, etc.). Pass the path to subagents that run `gh` commands so they can self-recover. Note: `gh pr merge` has no curl fallback — if unavailable, surface the failure to the user.

---

## Rules

1. **Delegate mode only** — never read project files, run git/gh commands, or write to disk yourself. Coordinator-only direct operations are limited to: Pre-Continuation Checks (Bash session-state read, `/reload-plugins`, `/compact`), timer management (CronCreate/CronDelete), channel notifications (Telegram tool), and the Monitor tool for CI/PR polling. All story-level operations are delegated to subagents.
2. **One subagent per step per story** — spawn only after the previous step reports success.
3. **Sequential steps within a story** — Steps 1→2→3→4→5→6→7 run strictly in order.
4. **Parallel stories** — launch all stories' Step 1 in one message (one tool call per story). Phase 3 runs sequentially by design.
5. **Dependency graph is authoritative** — never pick a story whose dependencies are not fully merged. Use Phase 0's report, not your own file reads.
6. **Phase 0 runs before every batch** — always after the Phase 4 wait. Always as a fresh subagent.
7. **BAD always halts after a batch** — after Phase 4 Step 3 prints its summary, BAD stops. No timer, no auto-restart, no monitor. Pedro starts the next batch by running `/bad` in a new session after reviewing and merging PRs.
8. **Confirm success** before spawning the next subagent.
9. **sprint-status.yaml is coordinator-managed on main only** — Step 1 (which runs in `{repo_root}` on main) flips to `ready-for-dev` directly. After Steps 2, 3, 7 succeed in their feature worktrees, the coordinator on main commits the corresponding flip (`atdd-done`, `review`, `done`) and pushes to origin/main. Subagents in feature worktrees (Steps 2-7) MUST NOT modify sprint-status.yaml — the hash-snapshot gate halts the pipeline if they do. This eliminates the dual-flip rebase conflicts observed at Epic 2 PR #65.
10. **On failure** — report the error, halt that story. No auto-retry. **Exception:** rate/usage limit failures → run Pre-Continuation Checks (auto-pauses until reset) then retry.
11. **Issue all Step 1 subagent calls in one response** when Phase 2 begins. After each story's Step 1 completes, issue that story's Step 2 — never wait for all stories' Step 1 to finish before issuing any Step 2. This rolling-start rule applies to all sequential steps within a story.
12. **Pre-Continuation Checks are mandatory at every gate** — run `references/coordinator/gate-pre-continuation.md` between every step spawn, after each Phase 3 merge, and before every Phase 0 re-entry. Never skip or defer these checks, even when handling multiple parallel story completions simultaneously.

---

## TODO — design needed before BAD runs Story 1.6+

The following items are flagged in `_bmad-output/implementation-artifacts/bad-customization-notes.md`
but require design before they can be encoded as gates. Do NOT run BAD on
stories these items affect until designed:

1. **Bundle C auto-merge gate** — block auto-merge of Stories 5.1, 5.2, 6.1, 6.2,
   6.3, 7.2, 7.3, 7.6 to main until Story 7.8's atomicity-bundle gate test passes.
   Likely mechanism: `block_auto_merge_until_story` field in sprint-status.yaml.

> **Resolved 2026-05-03:** calendar-early sequencing (Stories 9.0/9.1 between
> Epic 2 and Epic 3) and the Epic-Start Test Design re-entry guard for Epic 9
> are now implemented. See Phase 1 selection rules + Epic-Start trigger above,
> and the two top-level blocks in sprint-status.yaml: `calendar_early_overrides:`
> (the per-story exception) and `epic_test_design:` (the durable Epic-Start flag,
> map of epic number → `pending` | `done`).
