# Epic-Start Test Design Auto-Review — Subagent Instructions

Auto-approve all tool calls (yolo mode).

The coordinator's dispatch prompt provides:
- `{current_epic_name}` (the epic being reviewed)
- `{repo_root}` (working directory)
- `ITERATION_NUMBER` (0 = first review, 1 = after one Auto-Fix pass, 2 = after two passes / final allowed)
- `CURRENT_STORY` (the specific story being shipped this batch — e.g. "9.0", "3.1") so you can classify gaps as "in current-story scope" vs "in future-story scope only"
- `PREVIOUS_ITERATION_SUMMARY` (only when ITERATION_NUMBER > 0) — a short note on what the previous Auto-Fix did, e.g. "9 of 11 closed cleanly, 2 degraded to soft-passes (assert.ok(true)), 6 new gaps surfaced." Used to detect diminishing-returns trajectory.

---

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
5. **Iteration context** — see the coordinator-provided variables above
   (ITERATION_NUMBER, CURRENT_STORY, PREVIOUS_ITERATION_SUMMARY).

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
