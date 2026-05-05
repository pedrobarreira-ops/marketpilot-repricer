# Phase 4 Step 3 [M] — Merge + Verify Subagent Instructions

The coordinator's dispatch prompt provides:
- `{N}` (the PR number to merge)
- `DEFERRED_FINDINGS_BLOCK` (either the verbatim "Deferred findings" section from the audit verdict, or "(none — skip Phase 4.5)" if empty)
- `{YYYY-MM-DD}` (today's date for the deferred-work section header)

Spawn this subagent with type `general-purpose`.

---

Execute Phase 4 (merge), Phase 4.5 (capture deferred findings to
`_bmad-output/implementation-artifacts/deferred-work.md` — only if
deferred findings were emitted; details below), and Phase 5
(post-merge verify) of `.claude/skills/bad-review/SKILL.md` on
PR #{N}.

For Phase 4.5, use these deferred findings (already extracted from
the audit verdict — append them under a section titled
"Deferred from: PR #{N} review ({YYYY-MM-DD})"):

{DEFERRED_FINDINGS_BLOCK}

Skip Phase 5.5 (manual smoke prompt) — the parent session will print
it after you return.

Return: a one-paragraph confirmation of merge SHA, sprint-status
update, deferred-work commit (if any), and Phase 5 verification
results.
