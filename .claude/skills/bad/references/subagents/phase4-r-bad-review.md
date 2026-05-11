# Phase 4 Step 3 [R] — Inline bad-review Audit Subagent Instructions

The coordinator's dispatch prompt provides:
- `{N}` (the PR number to audit)

Spawn this subagent with type `general-purpose` (it needs the Agent tool to spawn its own audit subagents).

---

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
  audit independently.
- Use the model directives in bad-review's SKILL.md for inner
  subagents (Subagents A and C use Opus; B and D use Sonnet).

**CRITICAL — Phase 2 subagent dispatch (added 2026-05-11 after 5 sightings of inline self-analyze):**

You MUST spawn the 4 Phase 2 audit subagents (Subagents A, B, C, D per
`bad-review/SKILL.md` Phase 2) as parallel Agent() calls. Each gets a
fresh context and runs its own audit dimension independently. Do NOT
execute their prompts inline yourself.

**Required behavior:**
1. When you reach Phase 2, dispatch all 4 subagents in a single message
   with 4 parallel Agent tool calls (per `bad-review/SKILL.md` line
   183-185: "Launch all four in a **single message** (parallel
   execution)").
2. Each subagent receives ONE of the prompt files (`code-vs-spec.md`,
   `mcp-alignment.md`, `test-quality.md`, `body-vs-diff.md`) and the
   coordinator's gathered variables — NOT all four prompt files.
3. You synthesize their 4 returned reports into the Phase 3 verdict.
4. You do NOT read the 4 subagent prompt files yourself unless you are
   debugging the dispatch.

**Self-check trigger:** if you find yourself about to Read more than
one of `code-vs-spec.md`, `mcp-alignment.md`, `test-quality.md`,
`body-vs-diff.md` in this audit run → STOP. You should be dispatching
them as subagents, not reading them. Reading one (for reference) is
fine; reading two or more is the inline self-analyze antipattern.

**HALT directive if Agent tool is unavailable:** if your context does
not have the Agent tool (you cannot make `Agent()` calls), HALT
immediately and report this verbatim:
`❌ Agent-tool-unavailable: cannot spawn Phase 2 subagents from
nested-subagent context. Escalate to coordinator. Audit not run.`
Do NOT silently fall back to inline analysis — that loses the
four-way-independence-via-fresh-context property the audit relies on.
The coordinator will then either fix dispatch propagation or
explicitly authorize an inline fallback for this run.

**Test execution rule:** if you need to run local validation tests
(`npm test`, `node --test`, etc.) during Phase 1 or Phase 2, always
use synchronous Bash. NEVER spawn the test process in background and
use Monitor — background+Monitor can stall the audit if the test
process never terminates cleanly, exhausting context budget without
producing a verdict. (Root cause of PR #88 first-audit truncation at
11m 44s on 2026-05-11.)

Return your output as the full Phase 3 verdict report verbatim
(markdown), including all required sections: PR title line, Prior
deferred context (if any), Code vs spec, MCP alignment, Test quality,
PR body accuracy, Overall verdict, Manual smoke checklist,
Recommendation, and Deferred findings.
