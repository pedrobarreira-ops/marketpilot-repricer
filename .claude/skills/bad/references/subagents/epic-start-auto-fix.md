# Epic-Start Test Design Auto-Fix — Subagent Instructions

Auto-approve all tool calls (yolo mode).

The coordinator's dispatch prompt provides:
- `{current_epic_name}` (the epic with gaps to fix)
- `{repo_root}` (working directory)
- `MECHANICAL_GAPS_BLOCK` (the verbatim "Mechanical gaps (auto-fixable)" section from the auto-review)

---

The auto-reviewer flagged the following mechanical gaps in the test
scaffolds for this epic:

{MECHANICAL_GAPS_BLOCK}

For each gap:
- Add the missing test file or test case.
- Bind missing fixtures to behavioral tests.
- Add SSoT module coverage where missing.
- DO NOT touch tests outside the listed gaps. DO NOT modify production code.

Commit all changes to main with message "Epic-Start auto-fix: <epic_name>"
and push to origin/main. Report: success + files modified, OR failure +
reason.
