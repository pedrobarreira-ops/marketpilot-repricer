# Epic 6 Retrospective — BAD Pipeline (scoped, partial)

**Date**: 2026-05-10
**Facilitator**: Bob (`bmad-retrospective`)
**Project Lead**: Pedro
**Scope**: BAD pipeline learnings only. Bundle C is open (PRs #83, #84, #85 all merge-blocked behind Story 7.8). Production-correctness, live-smoke, counter-ownership-in-prod verdicts are deferred to a Bundle C retrospective post-7.8.
**Stories Reviewed**: 6.1 (review, PR #83 OPEN), 6.2 (review, PR #84 OPEN), 6.3 (review, PR #85 OPEN — course-corrected mid-review)
**Context-budget audit**: ✅ clean — `node scripts/context-budget.js` reports all files within threshold (TOTAL 34.6k tokens per BAD subagent spawn; `bad/SKILL.md` at 986/1000)
**Sprint-status update**: `epic-6: in-progress` (UNCHANGED — Bundle C still open); `epic-6-retrospective: optional` (UNCHANGED — Bundle C retro pending). This scoped retro is logged but does NOT close the epic-6-retrospective key.

---

## Why a scoped retro now

Epic 6's three stories all shipped through BAD into `review` state, all stacked on Bundle C's atomicity exception. The pipeline itself surfaced four new failure modes across Steps 5 and 7 — most acutely the Story 6.3 production wire-up gap that BAD's inline review layers (Steps 5 + 7) missed but `/bad-review` caught spec-grounded. `/bmad-correct-course` was used for the first time in the project to roll Story 6.3 back to `atdd-done` and re-dispatch through BAD with amended ACs; it worked cleanly and is worth recording as a positive validation. Q1/Q2/Q4 patches from the Epic 5 retro held with zero recurrence across three Bundle C dispatches. Production correctness and live smoke for Stories 6.1/6.2/6.3 remain deferred to the post-7.8 Bundle C retro.

---

## (a) Step 7 truncation on Story 6.3 — bmad-code-review skill stopped after sub-step 2

**Symptom:** Step 7 (PR review) on the Story 6.3 course-correction commits (451e06b additive impl) ran the `bmad-code-review` skill, which produced 63 raw findings across the three review layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) but stopped after sub-step 2 — never executing the triage step that filters raw findings into `[Patch]`/`[Decision]`/`[Defer]`/`[Dismiss]` buckets. Pedro received an unfiltered 63-line list with no actionability.

**Caught by:** Pedro reading the Step 7 output and noticing the missing triage tail. No automated gate detected it.

**Root cause (suspected, needs confirmation):** Output-length truncation at the model layer — sub-step 2 emitted the full raw-finding dump, sub-step 3 (triage) never received the budget to run. Same class as the bad-review Phase 2 self-analyze pattern: the skill's downstream steps depend on context being available, and the framework didn't verify every sub-step ran.

**Recurring risk:** Likely yes — any high-finding-count review (large diffs, multi-AC stories, course-correction additive commits) could hit the same ceiling. Story 6.3's course-correction touched 5 modules across 3 stories, so the finding count was unusually high; smaller-diff stories may not surface this.

**Fix (recommended — Q1 of Epic 6 retro):** Add a Step 7 post-condition check in BAD's coordinator: after the `bmad-code-review` skill returns, the coordinator parses the output for the literal section markers `## Sub-step 1:` / `## Sub-step 2:` / `## Sub-step 3:` (or whatever the skill emits). If sub-step 3 (triage) is missing, halt with a recovery message asking Pedro whether to re-spawn Step 7 with a smaller-diff scope or accept the un-triaged findings. Cost: ~6 lines coordinator-side. Risk: false positive if the skill's section headers ever change wording — mitigated by making the marker pattern the single source of truth in `bad/SKILL.md`.

**Alternative considered:** Increase output budget for the bmad-code-review subagent. Rejected — doesn't address the root cause (sub-steps with no completeness check), and Story 6.3's 63-finding case probably isn't an outlier; future Bundle C participants and Epic 7 stories will likely hit the same ceiling.

---

## (b) Step 7 adversarial-hunter signal-to-noise — 1.6% verification rate

**Symptom:** Of the 63 raw findings emitted by Step 7's adversarial review layers (Blind Hunter + Edge Case Hunter primarily), only 1 finding survived to the `[Patch]` bucket on a manual triage Pedro performed afterward. That's a 1.6% verification rate (1 / 63). The other 62 findings were either (a) already-handled by the spec, (b) factually incorrect about the code's behavior, (c) addressing a non-issue (e.g., theoretical race that the surrounding pg transaction precludes), or (d) cosmetic style preferences below the patch threshold.

**Caught by:** Manual triage post-Step 7. No automated metric tracks this.

**Recurring concern:** This is the second epic where adversarial review noise has been notable (Story 6.1 Step 5 review also produced ~12 findings, all 12 dismissed or deferred — see commit `ae9a014`'s "Findings dismissed as non-issues" section). The pattern is consistent: adversarial hunters generate hypothesis-driven critiques, most of which don't survive ground-truth verification against the actual code + spec.

**Why this matters:** Each unverified finding consumes Pedro's triage attention. At 63 raw / 1 surviving, the cost-to-value ratio is high — Pedro spent more time triaging than the patch saved. If signal-to-noise stays at this level for Bundle C remainder + Epic 7, the adversarial layers become net-negative on velocity even though they produce real findings occasionally.

**Fix (recommended — Q2 of Epic 6 retro):** Add a 4th adversarial sub-step BEFORE triage: a "ground-truth verifier" pass that takes each raw finding and checks it against the code/spec. Findings that fail verification (factually wrong about behavior, already addressed by spec, or below patch threshold) get auto-dismissed before reaching Pedro. Cost: ~1 extra adversarial pass per Step 7 (token cost). Benefit: Pedro sees only the verified subset (1-3 findings on a typical diff) instead of the full hypothesis dump. Risk: verifier hallucinates and dismisses real findings — mitigated by keeping the dismissed list in the skill output (collapsible) so spot-checks remain possible.

**Alternative considered:** Lower the adversarial layers' confidence threshold (only emit findings the hunter is >70% confident on). Rejected — moves the calibration burden inside the hunter prompt where it's harder to tune, and a lower threshold drops genuinely-suspicious-but-uncertain findings that occasionally turn out to be real.

**Watch trigger if not patched:** If next 3 BAD Step 7 runs (Stories 7.2/7.3/7.6) all produce >20 raw findings with <5% verification rate, promote Q2 from "recommended" to "P0 blocking next dispatch."

---

## (c) Step 5 + Step 7 missing spec-grounded checks — original PR #85 wire-up gap

**Symptom:** Story 6.3's original ship (commit d0bb844 → PR #85 first iteration) passed all four review layers — Step 4 ATDD review, Step 5 Code review, Step 7 PR review — and would have been merge-eligible if not for Bundle C blocking it. **The story's primary deliverable was dead code.** `scheduleRebuildForFailedSkus` was implemented + unit-tested (17 tests pass) but never invoked from production: the upstream poller (`pri02-poller.js`) never called it, and the parser early-exited on undefined `lineMap` so the rebuild path was unreachable.

**Caught by:** `/bad-review` (the standalone post-merge audit), specifically its `code-vs-spec` subagent which read Story 6.3 spec Dev Note 4 verbatim and grepped the code for the `scheduleRebuildForFailedSkus` call site. Found zero invocations.

**Why Step 5 and Step 7 missed it:**
- Step 5 (`bmad-code-review`, three adversarial layers) is **diff-grounded** — it asks "is this code internally consistent / safe / edge-case-correct?" Not "does this code wire up to upstream callers per the spec?"
- Step 7's PR review subagent reads the diff against the spec but treats the spec as a reference for correctness inside the diff, not for cross-file integration the diff *should have* but doesn't.
- Neither layer had a "the spec says X must call Y; grep for the call site" check as a structural guarantee.

**Why bad-review caught it:** The `code-vs-spec` subagent's prompt instructs it to enumerate spec ACs and Dev Notes, then verify each one is realized in the code — including cross-file wire-up. AC#5 (course-corrected version), AC-implicit-from-Dev-Note-4 (original version) both demanded production wire-up; bad-review traced the callgraph and found the gap.

**Recurring risk:** Any future story whose AC mandates cross-file integration ("X must call Y" / "the route must invoke Z") is exposed. Bundle C remainder includes 7.2 (engine import from writer SSoT), 7.3 (cooperative absorb skip on pending, depends on poller state), 7.6 (circuit breaker reads counter from poller). All three have similar cross-file invariants.

**Fix (recommended — Q3 of Epic 6 retro):** Add a 4th review dimension to BAD Step 5 — a `spec-wire-up` layer that explicitly enumerates "spec says X must call Y" sentences from the story's ACs and Dev Notes, then greps the code for the call sites. Output: pass/fail per "must call" assertion. Cost: ~1 extra Opus pass per Step 5. Benefit: structural guarantee against the Story 6.3 class of bug, not "we hope the adversarial layers happened to spot it." Risk: layer over-eager on natural-language interpretation — mitigated by requiring the spec to use a specific marker (e.g., `[WIRE-UP]:`) for assertions the layer should check, opt-in.

**Alternative considered:** Lift bad-review's `code-vs-spec` subagent into BAD as the new Step 5 layer. Rejected for now — duplicates effort (bad-review will run anyway on every PR), increases token spend per story, and the value of bad-review's independence (fresh context, post-merge / pre-Bundle-C-merge) is partly its separation from BAD's pipeline. Better to add the narrow `spec-wire-up` check as a cheap structural guarantee and let bad-review remain the deeper independent audit.

**Owner:** Pedro (BAD upstream patch).

---

## (d) /bmad-correct-course workflow validation — positive

**Outcome:** First use of `/bmad-correct-course` in the project (2026-05-09, post-PR #85 bad-review). Worked cleanly end-to-end:
- Issue summary correctly identified the wire-up gap and counter double-count latent bug.
- Impact analysis correctly scoped to "Minor" (no epic-level scope change, no rollback, no replan).
- Recommended path (Option 1 — Direct Adjustment) was correct; Options 2 (rollback) and 3 (PRD review) were correctly dismissed.
- Detailed plan produced 3 new ACs (#5, #6, #7), 1 new Dev Note (#15 — counter ownership LOCKED), and structural changes (course-correction banner, files-to-create extension, checklist subsection) — all additive.
- Handoff to BAD via `review → atdd-done` flip was clean; Phase 0's bundle-stacked exception picked up Story 6.3 on the next `/bad` run and dispatched Step 3 onto the existing PR #85 branch (additive commits on 5653abe, no reset, no force-push).
- BAD Steps 4-7 reviewed the new commits with full Opus rigor.
- PR #85 stayed open + merge-blocked throughout — `merge_blocks: 6-3 → 7-8` was untouched.

**What it explicitly avoided (positive):**
- Did NOT implement the code fix inside `/bmad-correct-course` (per Pedro's explicit instruction). Spec-only edits + sprint-status flip; code work routed back to BAD's Step 3 dev agent with full review chain.
- Did NOT re-write Story 6.3 from scratch. Additive AC pattern preserved the 17 already-passing tests and AC#1-4 work.
- Did NOT touch `merge_blocks` or atomicity-bundle invariants.

**Verdict:** `/bmad-correct-course` is now a validated tool for mid-pipeline course-corrections. The pattern (`review → atdd-done` flip + spec amendment + BAD re-dispatch) preserves all upstream work and adds the corrective ACs as additive scope. Logged at `_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-09.md`.

**Action:** Capture the pattern as a reusable instinct — see Q4 below.

---

## (e) Q1 / Q2 / Q4 patches from Epic 5 retro — all held

| Patch | Held? | Evidence |
|---|---|---|
| **Q1** — Step 3 sprint-status backup/restore (`/tmp/bad-sprint-status-backup-{N}.yaml`) | ✅ Held | 3 Bundle C dispatches (Stories 6.1 / 6.2 / 6.3 first ship + 6.3 course-correction redispatch). Zero recurrence of the Story 5.2 sprint-status mutation pattern. The mechanical file-copy defeats subagent-side mutation regardless of which prompt path the dev-story workflow follows. |
| **Q2** — Step 6 `RUN_CI_LOCALLY` hard guard (skip Monitor entirely) | ✅ Held | PRs #83, #84, #85 all completed Step 6 without Monitor hangs. `step6-pr-ci.md:101-103` reads `RUN_CI_LOCALLY` BEFORE any Monitor branch. Local CI fallback (`npm run lint` + `npm run test:unit`) ran cleanly each time. |
| **Q4** — Done-flip merge confirmation gate (`gh pr view --jq .mergedAt`) | ✅ Held | All three Bundle C PRs are merge-blocked, so coordinator never advanced any of them past `review`. The gate's correctness was tested implicitly: the coordinator did NOT flip 6.1/6.2/6.3 to `done` despite Step 7 success, because the merge-confirmation check returned null (PRs blocked). Q4 working as designed. |

**Net benefit:** Three previously-recurring failure modes (Step 3 sprint-status mutation, Step 6 Monitor hang, done-flip push race) all stayed silent across Epic 6's three stories + the course-correction redispatch. Pipeline stability up; manual recovery work down.

**Q3 (Epic 5 retro, deferred to W4):** `[Skip-Live-Smoke:]` marker pattern is now **auto-injected** by the friction-killer patch in commit `5b5037b` (Step 6 reads `merge_blocks` and appends the marker template). PRs #83 / #84 / #85 all carry auto-injected markers. Zero manual `gh pr edit` operations required. Q3's standing-workaround cost dropped from ~5 PRs × manual-edit to zero.

**Verdict:** All 3 patches are sticky in main and have validated under live conditions. Epic 5 retro action items closed.

---

## (f) bad-review Phase 2 self-analyze — confirmed recurrence

**Status:** Already deferred at Epic 5 retro PR #84 observation (deferred-work.md:337); recurred on PR #85 (deferred-work.md:346).

**Two distinct trigger conditions observed:**

1. **PR #84 (Story 6.2, 2026-05-08):** Coordinator inherited Opus 4.7 from Pedro's parent session. Synthesized all 4 dimensions inline rather than spawning 4 parallel `Agent` calls. The audit was thorough (per-AC table, MCP table, behavioral test % classification, claim-by-claim PR body audit) — but the four-way independence-via-fresh-context property was lost.

2. **PR #85 (Story 6.3 course-correction, 2026-05-09):** Coordinator could not spawn 4 parallel `general-purpose` subagents because the Agent/Task tool was unavailable in the inline auditor's environment. Same outcome: thorough audit, lost independence.

**Why this matters:** The four parallel subagent dispatch is the load-bearing mechanism for fresh-context independent verification. Inline self-analysis, no matter how thorough, has the parent-session context bleeding through — the auditor knows what BAD's reviews already found, what tests already pass, what the spec says, and what Pedro has been thinking. That defeats the audit-from-scratch principle that catches things like the Story 6.3 wire-up gap.

**Fix (deferred again, NOT P0 for Epic 6):** Two paths discussed:
- (a) Verify whether the parent BAD coordinator can pass the Agent tool through to inline auditors (technical question — needs Pedro experimentation).
- (b) Add an explicit fallback note in `bad-review/SKILL.md` Phase 2: "if Agent tool unavailable, run all 4 prompt files inline against the gathered context with audit discipline" so the failure mode is at least visible in the output (the coordinator emits a banner saying "running in inline-fallback mode; independence-via-fresh-context property lost — manually verify findings against spec").

**Action:** Defer to next bad-review-touching work. Twice-recurred but not blocking — the audits *did* catch the Story 6.3 wire-up gap (PR #85 first audit pre-correction) and surfaced the dead-code import-fallback finding (PR #85 post-correction audit). The audits are working; the methodology marker is the cosmetic concern.

**Watch trigger for promotion:** If a Bundle C remainder bad-review (post-7.2 / 7.3 / 7.6) misses a finding that an independent fresh-context subagent would have caught (signal: bad-review reports clean, then a later live smoke or 7.8 gate test catches it), promote (b) to P0 immediately.

---

## (g) MCP token expiration mid-audit

**Symptom:** During one of the Bundle C bad-review runs (PR #84 or #85, exact run not logged), the Mirakl MCP authentication token expired mid-audit. The `mcp-alignment` subagent attempted a Mirakl MCP query and received an authentication error rather than schema data; the audit subagent did not surface this clearly — it continued and produced an MCP-alignment table that was actually a fallback to its training data, with no banner warning Pedro that the MCP was unavailable.

**Caught by:** Pedro noticing during manual review of the audit output that the MCP-alignment table's claims didn't match what he expected from his last Mirakl MCP run.

**Why it matters:** The Mirakl MCP is the project's single source of truth for Mirakl API specifics (per CLAUDE.md "Always Verify via MCP" rule). A silently-failed MCP query that gets backstopped by training data is exactly the failure mode the rule exists to prevent — the audit appears clean while resting on potentially-stale training data.

**Recurring risk:** Yes — every long-running audit (bad-review on 7.2/7.3/7.6 PRs will be similar duration to 6.3) crosses MCP token TTL. The audit subagents do not currently have an MCP-availability pre-check or a fallback banner.

**Fix (recommended — Q5 of Epic 6 retro):** Two complementary patches:
1. **MCP availability pre-check (bad-review Phase 1):** Before dispatching the 4 parallel audit subagents, run a single `ToolSearch` query for `mcp__mirakl` and verify a non-auth tool (e.g., `mcp__mirakl__list_offers`) is in the result set. If only the two `*authenticate` tools are present (the same pattern Story 6.1's MCP-gate fix `44622d6` uses), halt with a banner: "Mirakl MCP not authenticated; run authentication before continuing or accept training-data fallback explicitly."
2. **Audit-side fallback banner:** If a bad-review subagent attempts an MCP call and it fails, emit a verbatim banner at the top of its findings: `⚠ Mirakl MCP unavailable during this audit run — claims below are training-data fallback, NOT MCP-verified.` This makes the failure mode visible in the output Pedro reads, instead of silently degrading.

Cost: ~5 lines for (1) (lift the existing pattern from `bad/SKILL.md`'s Story 6.1 MCP gate fix); ~3 lines per audit subagent prompt for (2) (banner + fail-safe).

**Owner:** Pedro (bad-review SKILL.md edit).

**Net line-budget impact:** `bad-review/SKILL.md` is at 668/750 = 89% of threshold. Adding ~10 lines pushes it to ~678/750 — comfortable headroom.

---

## (h) Context-budget audit (CLAUDE.md mandatory)

```
File                                                                    Lines   Tokens  Threshold  Status
.claude/skills/bad/SKILL.md                                               986    11832       1000  near
.claude/skills/bad-review/SKILL.md                                        668     8016        750  ok
project-context.md                                                        583     6996        600  near
CLAUDE.md                                                                  81      972        100  ok
_bmad-output/planning-artifacts/architecture-distillate/_index.md         111     1332        150  ok
_bmad-output/planning-artifacts/epics-distillate/_index.md                452     5424        500  near
TOTAL                                                                    2881    34572

✓ All files within threshold. No compression needed.
```

**Watch items (none breach):** `bad/SKILL.md` (986/1000 = 98.6%), `project-context.md` (583/600 = 97.2%), `epics-distillate/_index.md` (452/500 = 90.4%) all sitting in the "near" band.

**Net change vs Epic 5 retro:** `bad/SKILL.md` 988 → 986 (−2 lines despite Q1+Q2+Q4 patches landing + the friction-killer patch — net was −9+6 = −3, and 5b5037b's +6 puts the file at 985/1000, with the MCP-gate fix `44622d6`'s +1 putting it at 986). Line-budget compliance discipline working.

**Q1+Q2+Q3 of Epic 6 retro (drafted above) line-budget impact:**
- Q1 Step 7 sub-step 3 completeness check: ~6 lines added; needs ≤6 lines compressed in the same patch.
- Q2 4th adversarial sub-step (ground-truth verifier): structural change to bmad-code-review skill + small wrapper edit in `bad/SKILL.md` — ~3 lines on the BAD side.
- Q3 spec-wire-up review layer: lives in `bad/SKILL.md` Step 5; ~10 lines for layer wiring + opt-in marker docs. Will require ~10 lines compressed elsewhere.
- **Combined: ~19 lines added to `bad/SKILL.md`. Currently at 986/1000 → 1005 if added without offset.** Each patch must remain net line-budget-neutral.

**Q5 (MCP availability check) line-budget:** `bad-review/SKILL.md` 668 → ~678 (+10). Comfortable.

---

## Action Items

### P0 — Blocking next Bundle C participant (Story 7.2)

**Q1 — Step 7 `bmad-code-review` sub-step completeness check**
- Edit `bad/SKILL.md` Step 7 spawn block: after the bmad-code-review subagent returns, parse output for the literal sub-step section markers. If sub-step 3 (triage) is missing, halt with recovery message asking Pedro whether to (a) re-spawn Step 7 with smaller-diff scope or (b) accept the un-triaged findings list verbatim.
- Net line-budget impact must be ≤0: ~6 lines added; remove ≥equivalent tokens of redundant prose from same file.
- Owner: Pedro (BAD upstream patch).
- Why: Story 6.3 course-correction Step 7 silently dropped triage (63 raw findings, no actionability). Pattern likely recurs on any high-finding-count diff.

### Strongly recommended pre-Story 7.2

**Q2 — Step 5 / Step 7 ground-truth verifier sub-step**
- Edit `bad/SKILL.md` Step 7 (and ideally Step 5) bmad-code-review skill invocation: add a 4th adversarial sub-step that takes each raw finding from sub-steps 1-2 (Blind / Edge Case hunters) and verifies it against the actual code/spec before passing to triage. Findings that fail verification get auto-dismissed.
- Net line-budget impact must be ≤0: ~3 lines on BAD side; main change is in the bmad-code-review skill itself (separate file, not budget-tracked).
- Owner: Pedro (skill edit + BAD prompt edit).
- Why: 1.6% verification rate on Story 6.3 Step 7 (1/63). Pedro spent more time triaging than the 1 patch saved. If next 3 BAD Step 7 runs (Stories 7.2/7.3/7.6) all show <5% verification rate, this becomes P0.

**Q3 — Spec-wire-up review layer in BAD Step 5**
- Edit `bad/SKILL.md` Step 5: add an opt-in 4th review dimension that enumerates spec sentences with `[WIRE-UP]:` markers (or similar opt-in syntax) and greps the code for the asserted call sites. Pass/fail per assertion.
- Stories that have cross-file integration ACs (Bundle C remainder: 7.2 / 7.3 / 7.6) should mark wire-up requirements with `[WIRE-UP]:` so the layer fires.
- Net line-budget impact must be ≤0: ~10 lines added; remove ≥equivalent tokens.
- Owner: Pedro (BAD upstream patch + spec-author convention).
- Why: Story 6.3's wire-up gap survived all four review layers; only `/bad-review`'s spec-grounded audit caught it. Bundle C remainder has similar cross-file invariants. Cheaper to add the structural check than rely on adversarial layers happening to spot it.

**Q4 — Capture `/bmad-correct-course` pattern as a reusable instinct**
- Document the validated pattern: `review → atdd-done` flip + spec amendment with additive ACs + sprint-change-proposal artifact + BAD re-dispatch onto existing branch with no reset/force-push. Reference the Story 6.3 case as the worked example.
- Living location: `_bmad-output/implementation-artifacts/bad-customization-notes.md` (existing file, ~2-3 paragraph appendix), or a memory entry for the next bmad-correct-course invocation.
- Net cost: documentation only.
- Owner: Pedro / Bob.
- Why: First validated use of `/bmad-correct-course` in the project. Pattern works; capture before it gets re-derived from scratch on the next mid-pipeline correction.

**Q5 — bad-review MCP availability pre-check + fallback banner**
- Edit `bad-review/SKILL.md` Phase 1 (before the 4 parallel audit subagents dispatch): add MCP-availability check using the same filtered-tool pattern as `bad/SKILL.md`'s Story 6.1 MCP gate fix (commit `44622d6`).
- Edit each audit subagent prompt (`code-vs-spec.md`, `mcp-alignment.md`, etc.) to emit a verbatim banner if their MCP call fails: `⚠ Mirakl MCP unavailable during this audit run — claims below are training-data fallback, NOT MCP-verified.`
- Net line-budget impact: `bad-review/SKILL.md` 668 → ~678 (+10). Comfortable.
- Owner: Pedro.
- Why: One Bundle C bad-review run silently degraded to training-data fallback when the MCP token expired mid-audit. Trip-wire is needed to make the failure mode visible.

### Watch items

**Item W1 — bad-review Phase 2 self-analyze recurrence (carry-forward from Epic 5 retro)**
- Twice-recurred (PR #84 inherited-Opus path; PR #85 Agent-tool-unavailable path). Audits still produce real findings, but lose the four-way fresh-context independence property.
- Watch trigger: if a Bundle C remainder bad-review reports clean and a later live smoke or 7.8 gate test catches a finding that fresh-context audit subagents would plausibly have caught, promote to P0 immediately. Also if Pedro tires of the manual independence-property concern.
- Owner: Pedro (verify Agent-tool passthrough OR add explicit inline-fallback banner in `bad-review/SKILL.md` Phase 2).

**Item W2 — Adversarial-hunter signal-to-noise (Q2 watch)**
- 1.6% verification rate on Story 6.3 Step 7 (63 raw → 1 patch). Story 6.1 Step 5 also dismissed 12/12 findings (commit ae9a014's "Findings dismissed as non-issues" section).
- Watch trigger: if next 3 BAD Step 7 runs (Stories 7.2/7.3/7.6) all produce >20 raw findings with <5% verification rate, promote Q2 from "recommended" to "P0 blocking next dispatch."
- Owner: Pedro.

**Item W3 — Mandatory pre-merge live smoke for Bundle C participants (carry-forward from Epic 4 + Epic 5 retros)**
- Bundle C participants only run live smoke at the 7.8 gate; before that, they merge with no Mirakl-real verification.
- Watch trigger: at the Bundle C retro post-7.8, count live-smoke-caught bugs vs fixture-test-caught bugs to confirm the 7.8 single-gate model is sufficient (vs adding per-PR smoke).
- Owner: Bob (defer to Bundle C retro).

**Item W4 — Phase 0 reconciliation churn (carry-forward from Epic 5 retro)**
- Epic 5 batch ran 12 reconciliation passes; Epic 6 batch ran ~5 passes (passes 14-18 visible in commit log) — significant drop, consistent with the prediction that the Story 5.x patches would settle.
- Watch trigger: if Bundle C remainder participants (7.2/7.3/7.6) require ≥2 fresh mid-batch coordinator patches each, hold dispatch and audit Phase 0 logic before continuing.
- Owner: Bob.

**Item W5 — `[Skip-Live-Smoke:]` auto-injection (Q3 from Epic 5 retro, demoted to standing-workaround)**
- Auto-injection patch (commit `5b5037b`) verified working across PRs #83 / #84 / #85. Zero manual `gh pr edit` operations.
- Watch trigger: if Bundle C remainder PR (#86 / #87) auto-injection fails or any Bundle C PR's marker fails to satisfy the bad-review guard, surface here.
- Owner: Pedro.

---

## Epic 5 Retro Action-Item Follow-Through

| Item | Description | Status | Evidence |
|---|---|---|---|
| Q1 | Step 3 sprint-status backup/restore | ✅ Held | 3 Bundle C dispatches; zero recurrence of mutation pattern |
| Q2 | Step 6 RUN_CI_LOCALLY hard guard | ✅ Held | PRs #83/#84/#85 all completed Step 6 without Monitor hangs |
| Q4 | Done-flip merge confirmation gate | ✅ Held | All 3 Bundle C PRs stayed at `review`; coordinator never advanced |
| Q3 (deferred) | `[Skip-Live-Smoke:]` standing workaround | ✅ Auto-injected | `5b5037b` patch removes the manual edit — zero markers manually applied |
| W1 (Phase 0 churn) | Reconciliation pass count | ✅ Improved | 12 passes Epic 5 → 5 passes Epic 6 |
| W2 (Step 5 review-pollution) | Inherited-diff finding duplication | ✅ No regression | PR #83 / #84 / #85 Step 5 reviews produced no upstream-PR-duplicate findings |
| W3 (Bundle C live smoke) | Pre-merge live-smoke verdict | ⏸️ Deferred | Bundle C retro post-7.8 |
| W4 (bad-review Live Smoke false-positive) | Standing workaround verdict | ✅ Auto-injected (W5 above) | Manual marker fatigue trigger never fired |

**Epic 4 retro carry-forwards (Items 4/5/6):** Still deferred — Epic 6 stories were all worker-only / shared-module work; no route stories. Items 4/5/6 carry into Bundle C retro post-7.8 for the first opportunity to verify against route-touching code.

---

## Significant Discoveries — Result (BAD-pipeline scope only)

| Check | Result |
|---|---|
| BAD coordinator architecture proven wrong? | No — Q1+Q2+Q4 from Epic 5 retro held under Bundle C live conditions |
| Stacked-worktree dispatch model proven wrong? | No — 3 stacked dispatches all clean; 1 mid-pipeline course-correction redispatch also clean |
| Step 5 / Step 7 fundamental redesign needed? | No — three local fixes (Q1 sub-step completeness check, Q2 ground-truth verifier, Q3 spec-wire-up layer) |
| `/bmad-correct-course` workflow needs revision? | No — first use validated cleanly; capture pattern via Q4 documentation |
| New BAD pipeline failure modes uncovered? | Yes — 4 (Step 7 sub-step truncation, adversarial S/N ratio, Step 5+7 spec-wire-up gap, MCP-token-expiry-mid-audit silent degrade); each addressed by Q1-Q5 |

**Verdict:** NO BAD pipeline architectural changes. 5 sequenced patches (Q1 P0; Q2/Q3/Q4/Q5 strongly recommended) before Bob shards Story 7.2. Q1 must land before next dispatch (any high-finding-count Step 7 risks the same truncation). Q3 ideally lands before 7.2 because Bundle C remainder has the highest density of cross-file wire-up invariants. Q2 and Q5 can ride alongside.

**Production-correctness verdict for Stories 6.1 + 6.2 + 6.3 is held back to the Bundle C retrospective after Story 7.8 lands.** The atomicity-gate test at 7.8 is the joint correctness signal — assessing PRI01 writer aggregation, PRI02 poller cron handler, PRI03 parser per-SKU rebuild semantics, counter-ownership-in-prod, and the now-real wire-up chain in isolation before that gate fires would be premature.

---

## Readiness Assessment (BAD-pipeline scope only)

| Area | Status | Notes |
|---|---|---|
| Stories shipped through pipeline | ✅ 3/3 | 6.1 → review (PR #83 OPEN), 6.2 → review (PR #84 OPEN), 6.3 → review (PR #85 OPEN, course-corrected) |
| BAD coordinator integrity | ⚠️ Open | Q1 patch (Step 7 sub-step completeness) recommended before Story 7.2 |
| BAD Step 5 / Step 7 review depth | ⚠️ Open | Q2 (ground-truth verifier) + Q3 (spec-wire-up layer) recommended before 7.2 |
| bad-review Phase 2 self-analyze | ⚠️ Recurrence | Twice now; audits still produce real findings; defer to W1 trigger |
| bad-review MCP-token resilience | ⚠️ Open | Q5 (availability check + fallback banner) recommended |
| `/bmad-correct-course` workflow | ✅ Validated | First use clean; capture pattern via Q4 |
| Atomicity-bundle dispatch exception | ✅ Verified working | 4 stacked dispatches now (5.2 + 6.1 + 6.2 + 6.3) all held |
| `merge_blocks` enforcement | ✅ Verified working | All 3 Bundle C PRs correctly held from merge |
| `[Skip-Live-Smoke:]` auto-injection | ✅ Verified working | PRs #83/#84/#85 zero manual edits |
| MCP gate (pending-auth detection) | ✅ Verified working | `44622d6` patch caught the false-positive Story 6.1 dispatch attempt |
| Context budget | ✅ Within threshold | Watch `bad/SKILL.md` near 986/1000 — Q1+Q2+Q3 patches must compress |
| Production correctness of writer/poller/parser | ⏸️ Deferred | Bundle C retro post-7.8 |
| Live smoke (6.1 PRI01 submit / 6.2 PRI02 poll / 6.3 PRI03 parse) | ⏸️ Deferred | Bundle C retro post-7.8 |
| Counter-ownership-in-prod (poller-only after AC#7) | ⏸️ Deferred | Bundle C retro post-7.8 |
| Sprint-status retrospective key | ⏸️ NOT flipped to done | `epic-6-retrospective: optional` (UNCHANGED) — second retro pending |

---

## Key Takeaways

1. **Diff-grounded review can't catch missing code.** Step 5 and Step 7 are both diff-grounded — they ask "is what's in the diff correct?" not "is what should be in the diff actually there?" The Story 6.3 wire-up gap was missing-code, not bad-code. `/bad-review`'s spec-grounded `code-vs-spec` subagent caught it precisely because it works backwards from spec → code, not forwards from diff → review. Q3 brings a narrow version of that check into BAD's Step 5 as a cheap structural guarantee.

2. **Adversarial review without ground-truth verification is high-noise.** 1.6% verification rate (1/63) on Story 6.3 Step 7. The hunters generate hypotheses; without a verifier pass before triage, every hypothesis costs Pedro triage attention. Q2 inserts the verifier as a fourth sub-step — Pedro sees the post-verification subset, not the pre-verification dump.

3. **Skill sub-steps need completeness checks at the coordinator level.** The Step 7 truncation on Story 6.3 was silent — the skill emitted sub-steps 1-2 and stopped, no error. The coordinator didn't notice. Q1's structural sub-step marker check defeats this class of bug regardless of which skill is invoked.

4. **`/bmad-correct-course` is a validated mid-pipeline tool.** The `review → atdd-done` flip + additive AC pattern + BAD re-dispatch onto existing branch is now the canonical mid-pipeline correction recipe. Captured as Q4 documentation. Don't re-derive from scratch next time.

5. **MCP availability is a precondition, not an assumption.** The MCP-token-expiry-mid-audit silent degrade is the Mirakl-specific instance of "external dependency assumed available." Q5 makes the precondition checked + visible. Same pattern probably applies to other external dependencies as the project grows (Stripe MCP, Supabase MCP, etc.) — capture as a general principle when the third instance fires.

6. **Q1/Q2/Q4 patches from Epic 5 retro held cleanly.** Three stories + one course-correction redispatch with zero recurrence. Sticky upstream patches reliably reduce manual recovery work. The pattern of "one retro = one batch of upstream patches that land before the next dispatch" is working — keep it.

---

## Next Steps (ordered)

1. **Q1: Step 7 sub-step completeness check** — coordinator-side patch in `bad/SKILL.md` Step 7 spawn block. ~6 lines added; net line-budget impact ≤0.
2. **Q3: Spec-wire-up review layer in BAD Step 5** — opt-in `[WIRE-UP]:` marker convention + Step 5 layer wiring. ~10 lines added; net line-budget impact ≤0. Land before Bob shards Story 7.2 (highest cross-file invariant density in Bundle C remainder).
3. **Q5: bad-review MCP availability pre-check + fallback banner** — `bad-review/SKILL.md` Phase 1 + per-subagent banner. ~10 lines; comfortable headroom.
4. **Q2: Step 5 / Step 7 ground-truth verifier sub-step** — bmad-code-review skill edit + small BAD wrapper. Defer to next bmad-code-review-touching work if Q1/Q3 land first; promote to P0 if next 3 Step 7 runs all show <5% verification rate.
5. **Q4: Capture `/bmad-correct-course` pattern documentation** — append to `bad-customization-notes.md` or as memory entry. Cost: documentation only; do at convenience.
6. **Bob shards Story 7.2** — only after Q1 lands. Q3 strongly recommended pre-7.2; Q2 and Q5 can ride alongside or shortly after.
7. **Bundle C retrospective** — fires after Story 7.8 atomicity gate lands. Assesses joint correctness of dispatcher + staging + writer + poller + parser + engine + cooperative-absorption + circuit-breaker chain. Will close items deferred from this retro (live-smoke verdict, production-correctness verdict, counter-ownership-in-prod verdict, Epic 4 retro Items 4/5/6 follow-through with route stories) and assess W1/W2/W3/W4 trigger status.

---

**Scoped retrospective complete.** Sprint-status update: `epic-6-retrospective: optional` (UNCHANGED — Bundle C retro pending after Story 7.8); `epic-6: in-progress` (UNCHANGED). Document logged at `_bmad-output/implementation-artifacts/epic-6-retro-bad-pipeline-2026-05-10.md`.
