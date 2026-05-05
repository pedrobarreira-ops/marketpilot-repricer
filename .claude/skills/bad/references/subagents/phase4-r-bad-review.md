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
  audit independently. The 4 audit subagents you spawn (Subagents A,
  B, C, D per the SKILL.md) get fresh contexts as well.
- Use the model directives in bad-review's SKILL.md for inner
  subagents (Subagents A and C use Opus; B and D use Sonnet).

Return your output as the full Phase 3 verdict report verbatim
(markdown), including all required sections: PR title line, Prior
deferred context (if any), Code vs spec, MCP alignment, Test quality,
PR body accuracy, Overall verdict, Manual smoke checklist,
Recommendation, and Deferred findings.
