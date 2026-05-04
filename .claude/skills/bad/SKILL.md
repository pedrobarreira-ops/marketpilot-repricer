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
You are the epic test design agent for {current_epic_name}.
Working directory: {repo_root}. Auto-approve all tool calls (yolo mode).

1. Run /bmad-testarch-test-design for {current_epic_name}.
2. Commit any new test plan files.
3. Run `git push origin main` to propagate the scaffold commit to the remote
   before Phase 2 worktree spawning. Without this, worktree branches opened
   against origin/main carry the scaffold commit as a phantom diff, causing
   mechanical merge conflicts across parallel stories — observed previously
   when 2 of 3 PRs merged DIRTY for exactly this reason. The remote tip must
   contain the test scaffolds before any worktree branches off.
4. Update sprint-status.yaml at the REPO ROOT (not the worktree copy):
     _bmad-output/implementation-artifacts/sprint-status.yaml
   Flip the value of key {N} inside the top-level `epic_test_design:` block
   from `pending` to `done`. The block lives outside `development_status:`
   (sibling of `calendar_early_overrides:`) so other BMAD skills don't
   misclassify it. Commit and push this change in the same step. This
   durable flag is read by Phase 1's Epic-Start trigger to prevent re-firing
   when the same epic is entered twice — e.g. Epic 9, entered first via the
   calendar-early slot for Stories 9.0/9.1, then chronologically for 9.2-9.6
   between Epic 8 and Epic 10. If this step fails after the push in step 3,
   the next BAD start will (idempotently) re-fire Epic-Start:
   /bmad-testarch-test-design should detect existing scaffold files and
   no-op; worst case is a redundant empty commit on the worktree branch
   which Step 5 / Step 7 will catch. Acceptable redundancy.

Report: success or failure with error details.
```

**After Epic-Start Test Design completes — spawn an auto-review subagent (`MODEL_QUALITY` / Opus) BEFORE the user halt.**

The user is a non-developer and cannot meaningfully review test scaffolds directly. The halt remains (epic-wide test scaffolds are too consequential to skip a checkpoint), but what the user sees at the halt is a plain-language verdict from a fresh-context auditor — not raw test files.

### Auto-review subagent (`MODEL_QUALITY` — Opus)

Spawn after the test-design subagent reports success. This is judgment-heavy work — classifying coverage adequacy, identifying semantic gaps, distinguishing mechanical-fixable issues from spec-level ambiguity. Use Opus regardless of `MODEL_STANDARD`.

```
You are the Epic-Start Test Design auto-reviewer for {current_epic_name}.
Working directory: {repo_root}. Auto-approve all tool calls (yolo mode).

The test-design subagent just ran /bmad-testarch-test-design and committed
test scaffolds + plan files to main. Audit the output against the epic's
stories and produce a plain-language verdict for a non-developer reviewer.

INPUTS:
1. The list of files committed by the test-design subagent (read its commit
   diff: `git log -1 --name-only origin/main`).
2. The epic's stories from `_bmad-output/planning-artifacts/epics-distillate/`
   (load the section file containing this epic — see CLAUDE.md loading
   pattern — read the full ACs and SSoT module names).
3. The architecture distillate's SSoT modules index from
   `_bmad-output/planning-artifacts/architecture-distillate/_index.md`
   (section "Cross-Cutting: SSoT Modules Index") — used to verify every
   SSoT module the epic introduces has at least one test file targeting it.
4. The atomicity bundles cross-cutting from epics-distillate _index.md —
   used to verify atomicity-bundle gates are scaffolded where required.
5. **Iteration context** — the coordinator passes:
   - `ITERATION_NUMBER` (0 = first review, 1 = after one Auto-Fix pass,
     2 = after two passes / final allowed)
   - `CURRENT_STORY` (the specific story being shipped this batch — e.g.
     "9.0", "3.1") so you can classify gaps as "in current-story scope"
     vs "in future-story scope only"
   - `PREVIOUS_ITERATION_SUMMARY` (only when ITERATION_NUMBER > 0) — a
     short note on what the previous Auto-Fix did, e.g.
     "9 of 11 closed cleanly, 2 degraded to soft-passes (assert.ok(true)),
     6 new gaps surfaced." Used to detect diminishing-returns trajectory.

CHECKS (apply each, list findings):

A. AC behavioral coverage. For every AC across every story in this epic,
   does at least one named behavioral test bind to it? Behavioral = calls
   the implementation with fixtures, asserts on return value or state
   change. NOT keyword-grep (`src.includes(...)`) or skeleton (export
   exists). Map: AC-X.Y.Z → test file:test name OR "missing".

B. Fixture binding. If the epic's stories reference named fixtures (e.g.,
   `p11-tier1-undercut-succeeds.json`, `pri01-csv/single-channel-undercut.csv`),
   does each fixture either (a) exist on disk in `tests/fixtures/`, or
   (b) appear in the test plan's "to be created during Story X.Y" list?
   List unbound fixtures.

C. SSoT module coverage. For every SSoT module the epic introduces (per
   the architecture-distillate's SSoT modules index), is there a test file
   targeting it? Map: module path → test file OR "missing".

D. Atomicity bundle gates. If the epic includes a bundle gate story (e.g.,
   Story 7.8 for Bundle C), is the integration test file scaffolded with
   the named gate assertions (e.g., `pending_import_id` invariant test for
   Bundle C)? List missing.

E. Semantic adequacy. For each AC, is the test plan's assertion scope
   actually capable of catching a regression? Or is it generic ("renders
   without error") when the AC requires specific behavior ("redirects to
   /onboarding/scan within 5s")? List ACs where the test plan is too
   shallow to bind to the spec's actual requirement.

VERDICT TIERS:

- **Strong**: No findings in A-E, OR only minor findings with no critical
  gaps. Test plan is ready for Phase 2 to consume.
- **Acceptable**: A-D have minor mechanical gaps (missing test for an AC,
  missing fixture binding, missing SSoT coverage) that a fix subagent
  could plausibly close. E is clean (no semantic gaps).
- **Weak**: ANY of: many mechanical gaps in A-D (>30% of ACs uncovered),
  any unbound atomicity-bundle gate, OR any semantic gap in E. Cannot
  proceed without fixes. If E gaps dominate, the issue is likely
  spec-quality (the AC itself is too vague for any test to bind to) —
  flag this in the verdict so the user knows auto-fix may not converge.

REPORT FORMAT (stay under 700 words, plain language for a non-developer):

## Verdict: Strong / Acceptable / Weak (iteration {ITERATION_NUMBER})

## For non-developer reader (TL;DR)

Three required lines, mapped from the decision-rule table below:

1. **Recommended action: [C] / [Auto-Fix] / [S].** One bracketed letter, no ambiguity.
2. **Reasoning in one sentence.** Plain language, no jargon. Cover the load-bearing
   reason — typically one of: convergence trajectory, current-vs-future-story scope,
   architectural-mismatch gaps, iteration-budget exhaustion, semantic gaps present.
3. **When to pause and ask Claude before clicking.** One line. Trigger conditions:
   any gap in the current shipping story, any "semantic gap" finding, or any
   architectural-mismatch indicator (NFR timing tests at unit-test layer, perf
   budgets that can't be reliably asserted, etc.).

DECISION RULE TABLE — derive the recommendation from these scenarios:

| Scenario                                                                    | Recommend       |
|-----------------------------------------------------------------------------|-----------------|
| Strong verdict, any iteration                                               | [C] Continue    |
| Iteration 0, Acceptable, mechanical gaps in current-story scope             | [Auto-Fix]      |
| Iteration 0, Acceptable, mechanical gaps only in future-story scope, ≤5     | [Auto-Fix]      |
| Iteration 0, Acceptable, mechanical gaps only in future-story scope, ≥10    | [C] Continue    |
| Iteration 0/1, Weak verdict, mechanical-only                                | [Auto-Fix]      |
| Iteration 1, Acceptable, previous pass converged cleanly, current-story gaps | [Auto-Fix]      |
| Iteration 1, Acceptable, previous pass had soft-passes / arch-mismatch       | [C] Continue    |
| Iteration 2 (final allowed), any state                                      | [C] Continue    |
| Any iteration, semantic gaps present                                        | [S] Stop        |

Architectural-mismatch examples (justifying [C] over [Auto-Fix] in iteration 1+):
- NFR-P8 timing/perf assertions at node:test unit-test layer (flaky wall-clock,
  belongs in production monitoring or staging load tests, not unit tests)
- Cross-environment query-plan checks that need real DB sizing
- Integration-flaky tests that degraded to `test.skip(...)` or `assert.ok(true)`

Convergence-trajectory signals (good = lean Auto-Fix, bad = lean Continue):
- GOOD: "8 of 10 closed cleanly with behavioral assertions, 2 minor stragglers"
- BAD: "9 of 11 closed but 2 are pseudo-fixes; 6 new gaps surfaced on re-review"

When iteration 2 hits, [Auto-Fix] is no longer offered (3rd attempt halts BAD).
Only [C] and [S] are valid menu options at iteration 2.

## Summary (2-3 sentences in plain language)
{What's good about the test plan, what's missing if anything. No jargon.}

## Findings (bullet list, prioritized worst-first)
- [A/B/C/D/E] {specific finding} — {plain-language consequence if shipped as-is}

## Mechanical gaps (auto-fixable)
{List items in A-D that a fix subagent could close. Format as a numbered
todo list — exact file:line OR exact test name to add. For each item, tag
its scope: "[current-story]" if the gap affects {CURRENT_STORY}, otherwise
"[future-story: {N.M}]". The TL;DR uses these tags to apply the decision rules.}

## Semantic gaps (need spec rework, NOT auto-fixable)
{List items in E. If non-empty, the TL;DR MUST recommend [S] — auto-fix
won't converge.}

## Confidence: high / medium / low
{Your confidence the verdict is right. Low if the epic touches code or
patterns you can't fully evaluate from the spec alone.}

Return only the verdict report.
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

   The auto-reviewer flagged the following mechanical gaps in the test
   scaffolds for this epic:

   {paste the "Mechanical gaps (auto-fixable)" section from the auto-review}

   For each gap:
   - Add the missing test file or test case.
   - Bind missing fixtures to behavioral tests.
   - Add SSoT module coverage where missing.
   - DO NOT touch tests outside the listed gaps. DO NOT modify production code.

   Commit all changes to main with message "Epic-Start auto-fix: <epic_name>"
   and push to origin/main. Report: success + files modified, OR failure +
   reason.
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

Enforce by hash-snapshot around each:

Before spawning Step 2/3/4/5/6/7: compute `sha256sum _bmad-output/implementation-artifacts/sprint-status.yaml` → save as `STATUS_HASH_PRE`.
After Step 2/3/4/5/6/7 reports success: recompute → save as `STATUS_HASH_POST`.
If `STATUS_HASH_POST != STATUS_HASH_PRE`, HALT this story's pipeline with:
`❌ Story {number}: Step {N} modified sprint-status.yaml — state-machine
violation. Steps 2-7 run in feature worktrees and MUST NOT touch
sprint-status.yaml; only Step 1 (on main) and the coordinator own per-story
flips. Investigate the stray write, revert the sprint-status change, and
re-run.`

After Step 2/3/7 reports success and the gate passes, the coordinator
performs the post-step flip on main (see "Coordinator-Side Sprint-Status
Flips" below).

Rationale: dual-flip pattern (subagent flips in worktree + coordinator flips
on main) caused the PR #65 sprint-status conflict that required force-push +
rebase. Single-source-of-truth (main only, coordinator-driven) eliminates
the conflict class entirely. Step 1 is exempt because it runs on main, so
its flip and the coordinator's flip are the same operation.

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

For each: from main worktree, edit sprint-status.yaml, commit with the
message above, push to origin/main. Steps 4, 5, 6 do not flip (they're
intermediate quality checks within the dev → review transition).

### Step 1: Create Story (`MODEL_STANDARD`)

Spawn with model `MODEL_STANDARD` (yolo mode):
```
You are the Step 1 story creator for story {number}-{short_description}.
Working directory: {repo_root}. Auto-approve all tool calls (yolo mode).

1. Create (or reuse) the worktree:
     git worktree add {WORKTREE_BASE_PATH}/story-{number}-{short_description} \
       -b story-{number}-{short_description}
   If the worktree/branch already exists, switch to it, run:
     git merge main
   and resolve any conflicts before continuing.

2. Change into the worktree directory:
     cd {repo_root}/{WORKTREE_BASE_PATH}/story-{number}-{short_description}

3. Run /bmad-create-story {number}-{short_description}.

4. Run "validate story {number}-{short_description}". For every finding,
   apply a fix directly to the story file using your best engineering judgement.
   Repeat until no findings remain.

5. If this story touches any Mirakl endpoint (OF21, OF24, P11, PRI01, PRI02, PRI03, or any /api/* Mirakl call):
   FIRST verify against the live Mirakl MCP server (per CLAUDE.md: Mirakl MCP
   is the single source of truth — never assume from training data).
   THEN cross-reference against "Cross-Cutting Empirically-Verified Mirakl Facts"
   (16-row table) in
     {repo_root}/_bmad-output/planning-artifacts/architecture-distillate/_index.md
   Confirm this story's endpoint usage matches MCP exactly — field names, param names, response fields.
   Reminder: NEVER use OF24 for price updates (constraint #6 — OF24 resets
   unspecified offer fields to defaults). Use PRI01 for price-only updates.
   If there is any drift, correct the story spec before continuing.
   Add a one-line note at the top of the story spec: "Endpoints verified against Mirakl MCP and architecture-distillate empirical facts ({date})."

6. Commit the story spec file to the worktree branch:
     git add _bmad-output/implementation-artifacts/{story-spec-filename}.md
     git commit -m "Add story {number} spec"
   The spec file must be committed to the branch — never left as an untracked file.

7. Update sprint-status.yaml at the REPO ROOT (not the worktree copy):
     _bmad-output/implementation-artifacts/sprint-status.yaml
   Set story {number} status to `ready-for-dev`.

Report: success or failure with error details.
```

### Step 2: ATDD (`MODEL_STANDARD`)

Spawn with model `MODEL_STANDARD` (yolo mode):
```
You are the Step 2 ATDD agent for story {number}-{short_description}.
Working directory: {repo_root}/{WORKTREE_BASE_PATH}/story-{number}-{short_description}.
Auto-approve all tool calls (yolo mode).

1. Run /bmad-testarch-atdd {number}-{short_description}.
2. Commit any generated test files.
3. DO NOT modify sprint-status.yaml. The coordinator on main flips the
   story to `atdd-done` after this step reports success (see
   "Coordinator-Side Sprint-Status Flips" in the Sprint-Status Immutability
   Gate section). The hash-snapshot gate will halt the pipeline if this
   subagent writes to sprint-status.yaml.

Report: success or failure with error details.
```

### Step 3: Develop Story (`MODEL_STANDARD`)

Spawn with model `MODEL_STANDARD` (yolo mode):
```
You are the Step 3 developer for story {number}-{short_description}.
Working directory: {repo_root}/{WORKTREE_BASE_PATH}/story-{number}-{short_description}.
Auto-approve all tool calls (yolo mode).

1. Run /bmad-dev-story {number}-{short_description}.
2. Commit all changes when implementation is complete. **Do NOT include
   any change to `_bmad-output/implementation-artifacts/sprint-status.yaml`
   in your commits — the hash-snapshot gate will halt the pipeline if you
   do.** If `/bmad-dev-story` mentions writing to sprint-status, ignore
   that instruction; that flip is now coordinator-side.
3. DO NOT modify sprint-status.yaml. The coordinator on main flips the
   story to `review` after this step reports success.

Report: success or failure with error details.
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

1. Run /bmad-testarch-test-review {number}-{short_description}.
2. Apply all findings using your best engineering judgement.
3. Commit any changes from the review.

Report: success or failure with error details.
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

1. Run /bmad-code-review {number}-{short_description}.

2. MIGRATION IMMUTABILITY — before applying any fix:
   If a finding suggests editing an existing file in `supabase/migrations/`
   (not adding a new one), DO NOT patch the migration. Instead create a NEW
   migration file with the schema delta. Migrations are append-only after
   first commit — the remote `supabase_migrations.schema_migrations` table
   is invisible from this context, so editing an applied migration silently
   diverges local from remote. Flag as decision_needed and never apply.

3. Auto-accept all OTHER findings and apply fixes using your best engineering judgement.
4. Commit any changes from the review.

Report: success or failure with error details.
```

### Step 6: PR & CI (`MODEL_STANDARD`)

Spawn with model `MODEL_STANDARD` (yolo mode):
```
You are the Step 6 PR and CI agent for story {number}-{short_description}.
Working directory: {repo_root}/{WORKTREE_BASE_PATH}/story-{number}-{short_description}.
Auto-approve all tool calls (yolo mode).

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

1. Run /code-review:code-review (reads the PR diff via gh pr diff).
2. For every finding, apply a fix using your best engineering judgement.
   Do not skip or defer any finding — fix them all.
3. Commit all fixes and push to the PR branch.
4. If any fixes were pushed, re-run /code-review:code-review once more to confirm
   no new issues were introduced. Repeat fix → commit → push → re-review until
   the review comes back clean.
5. DO NOT modify sprint-status.yaml. The coordinator on main flips the
   story to `done` after this step reports success (see "Coordinator-Side
   Sprint-Status Flips" in the Sprint-Status Immutability Gate section).

Report: clean (no findings or all fixed) or failure with details.
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

   [R] Run /bad-review on the open PR(s) now (recommended)
       Spawns bad-review as a fresh-context subagent. After it returns,
       you'll see the verdict and decide whether to merge.
   [S] Stop BAD
       Don't run bad-review. You can run it manually in a new session.
   ```
   📣 **Notify:** `⏸ BAD halted — batch complete. [R] Run bad-review now, or [S] stop.`

   If no open PRs (`current_epic_merged = true` and no leftover PRs from earlier batches): omit the `[R]` option and just print `Run /bad in a new session to start the next batch.` Then stop BAD.

3. **[R] handler — Inline bad-review with fresh context:**

   For each open PR (sequentially — wait for each to fully resolve before starting the next):

   **3a. Spawn the audit subagent** (`general-purpose` type — needs `Agent` tool to spawn its own audit subagents):
   ```
   Agent type: general-purpose
   Description: bad-review audit on PR #{N}

   Prompt:
   You are running the `bad-review` skill on PR #{N}. Read
   `.claude/skills/bad-review/SKILL.md` and follow its instructions for
   Phases 1, 2, and 3 ONLY.

   Hard rules:
   - Do NOT execute Phase 4 (merge), Phase 4.5 (deferred capture), or
     Phase 5 (post-merge verify). The parent session will handle those
     based on user input.
   - Do NOT print or offer [M]/[F]/[S] options. Return immediately after
     Phase 3 produces its verdict report.
   - You have no prior context about this PR or BAD's verdicts. Run the
     audit independently. The 4 audit subagents you spawn (Subagents A,
     B, C, D per the SKILL.md) get fresh contexts as well.
   - Use the model directives in bad-review's SKILL.md for inner
     subagents (Subagents A and C use Opus; B and D use Sonnet).

   Return your output as the full Phase 3 verdict report verbatim
   (markdown), including all required sections: PR title line, Prior
   deferred context (if any), Code vs spec, MCP alignment, Test quality,
   PR body accuracy, Overall verdict, Manual smoke checklist,
   Recommendation, and Deferred findings.
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
     Execute Phase 4 (merge), Phase 4.5 (capture deferred findings to
     `_bmad-output/implementation-artifacts/deferred-work.md` — only if
     deferred findings were emitted; details below), and Phase 5
     (post-merge verify) of `.claude/skills/bad-review/SKILL.md` on
     PR #{N}.

     For Phase 4.5, use these deferred findings (already extracted from
     the audit verdict — append them under a section titled
     "Deferred from: PR #{N} review ({YYYY-MM-DD})"):

     {paste the "Deferred findings" section from the audit verdict, or
     "(none — skip Phase 4.5)" if the verdict had no deferred findings}

     Skip Phase 5.5 (manual smoke prompt) — the parent session will print
     it after you return.

     Return: a one-paragraph confirmation of merge SHA, sprint-status
     update, deferred-work commit (if any), and Phase 5 verification
     results.
     ```
     After the subagent returns, print its confirmation, then print bad-review's Phase 5.5 manual smoke prompt for this story (verbatim from the audit verdict's "Manual smoke checklist" section).

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
Read `_bmad-output/implementation-artifacts/sprint-status.yaml`. Extract:

1. The top-level `integration_test_required:` block. May be absent or empty —
   if so, return `INTEGRATION_TEST_BATCH = []` and exit.

2. For each story in the current batch (the coordinator passes the batch
   list as `BATCH_STORIES`), check whether the story key appears in the
   `integration_test_required:` block with value `true`. If yes, capture:
     - story key (e.g. "2-1-rls-aware-...")
     - the inline YAML comment after the `true` value (e.g.
       "pg Pool + RLS + auth contract surface") — this is the per-story reason

3. Read package.json and extract the full `test:integration` script value.
   Save as `TEST_INTEGRATION_CMD` (string) and `SCRIPT_EXISTS` (boolean).

4. Return:
   - INTEGRATION_TEST_BATCH: list of {story, pr_number, reason} for batch
     stories tagged `true`
   - SCRIPT_EXISTS: boolean
   - TEST_INTEGRATION_CMD: the raw script string (e.g.
     "node --env-file=.env.test --test --test-concurrency=1 ...")

The PR numbers come from Phase 4 Step 2's batch summary; the coordinator
substitutes them as `BATCH_STORIES_WITH_PRS`.
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

**Sub-step B3 — Run tests:**
Derive the test command from `TEST_INTEGRATION_CMD`:
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
