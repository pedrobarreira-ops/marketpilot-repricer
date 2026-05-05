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
