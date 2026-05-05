# Step 1: Create Story — Subagent Instructions

Auto-approve all tool calls (yolo mode).

The coordinator's dispatch prompt provides:
- `{number}` and `{short_description}` (story identifiers)
- `{repo_root}` (working directory at dispatch time)
- `{WORKTREE_BASE_PATH}` (root for git worktrees, e.g. `.worktrees`)

---

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
