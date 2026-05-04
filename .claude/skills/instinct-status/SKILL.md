---
name: instinct-status
description: Show the current state of the continuous-learning system — observation count, learned instincts (project-scoped + global) with confidence scores, and known projects. Use when checking what patterns have been learned across sessions, or to see if observations are accumulating before running /evolve.
origin: project
tools: Bash
---

# /instinct-status — Continuous Learning Status

Read-only viewer for the continuous-learning system. Shows what observations have been captured and what instincts have been extracted across this project + global scope.

## When to Use

- After a few sessions of work, check if observations are accumulating (need 20+ before `/evolve` extracts useful patterns)
- Before running `/evolve` to see how many observations are pending
- To inspect what behavioral patterns have been learned and at what confidence
- To see all 4 of Pedro's projects and instinct counts per project (when global scope is in use)

## How It Works

The slash command runs `node .claude/skills/continuous-learning/scripts/instincts.js status` and renders the output. The Node script:

1. Detects the current project (git remote URL → 12-char hash)
2. Reads observation count from `~/.claude/instincts/projects/<hash>/observations.jsonl`
3. Lists project-scoped instincts from `~/.claude/instincts/projects/<hash>/instincts/personal/`
4. Lists global instincts from `~/.claude/instincts/instincts/personal/`
5. Sorts each list by confidence score (highest first)

## Steps

1. Run the status command:

```bash
node .claude/skills/continuous-learning/scripts/instincts.js status
```

2. Display the output verbatim to the user.

3. If observation count is 0:
   - Confirm the hook is registered in `.claude/settings.json` (PreToolUse + PostToolUse with `observe.sh`)
   - Confirm the hook executable: `bash -c 'echo {} | bash .claude/skills/continuous-learning/hooks/observe.sh post'`
   - Note: the hook only fires from interactive Claude Code sessions (CLI / desktop / SDK with human-interactive flag), and skips subagent sessions by design (5-layer self-loop guard). So observations come from your direct conversation, not from BAD subagent runs.

4. If observation count >= 20 and project_instincts/global_instincts are both 0:
   - Recommend running `/evolve` to extract the first round of instincts.

5. If both observations and instincts are populated:
   - Just present the status. Mention that `/evolve` (when ready, Phase 2) clusters related instincts and surfaces promotion candidates to memory/.

## Other commands

- `count` — observation count + instinct count + ready-for-evolve flag (compact one-liner output)
- `projects` — list all known projects with instinct + observation counts (useful with global scope across multiple projects)

```bash
node .claude/skills/continuous-learning/scripts/instincts.js count
node .claude/skills/continuous-learning/scripts/instincts.js projects
```

## Disabling temporarily

Create the file `~/.claude/instincts/disabled` (any contents) and the hook becomes a no-op until the file is removed. Useful when you want to run a session without observation capture (debugging, sensitive work).

```bash
touch ~/.claude/instincts/disabled
# ... do work without observation ...
rm ~/.claude/instincts/disabled
```
