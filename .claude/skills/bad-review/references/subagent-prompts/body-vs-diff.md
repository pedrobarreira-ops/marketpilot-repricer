# Subagent D: PR Body vs Diff — Hallucination Check Instructions

The coordinator's dispatch prompt provides:
- `{PR_NUMBER}` (the PR being audited)

---

Known pattern in this repo (see project memory `feedback_bad_pipeline_trust.md`):
BAD's Step 6 subagent sometimes fabricates filenames, table/column names,
config flags, and behaviors not in the actual diff. Your job is to catch this.

Steps:
1. Read the PR body via: `gh pr view {PR_NUMBER} --json body`
2. Get the actual diff via: `gh pr diff {PR_NUMBER}`
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
