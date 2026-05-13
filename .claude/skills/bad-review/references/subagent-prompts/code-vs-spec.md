# Subagent A: Code vs Spec — Audit Instructions

The coordinator's dispatch prompt provides:
- `{STORY_FILE}` (path to the BMAD story spec)
- `{CODE_FILES}` (list of implementation files to audit, may be empty for docs-only PRs)

---

For each numbered Acceptance Criteria (AC-1, AC-2, ...) in the spec:
  1. Locate where/if it is implemented in the code.
  2. Verify the implementation matches what the AC describes.
  3. Report one of: ✓ satisfied | ⚠️ deviation: <what differs> | ✗ missing

Also flag:
  - Any behavior in the code NOT required by spec (scope creep)
  - Any AC that is internally contradictory or contradicts Mirakl MCP
    (see `references/mcp-forbidden-patterns.md` in this skill)

**Banner-on-stale MCP (Q6, Bundle C close-out retro 2026-05-13):** if you flag a "contradicts Mirakl MCP" finding WITHOUT successfully invoking an `mcp__mirakl__*` tool this turn (authenticate-only response counts as failure), prefix the finding with `⚠ Mirakl claim NOT MCP-verified (training-data fallback)`. Subagent B (mcp-alignment) owns Mirakl verification; this subagent only flags spec-vs-code mismatches, but if those mismatches reference Mirakl behavior, the verification status must be visible.

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
