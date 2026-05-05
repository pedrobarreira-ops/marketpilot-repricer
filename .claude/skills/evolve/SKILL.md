---
name: evolve
description: Extract atomic instincts from captured observations.jsonl by spawning a Haiku subagent. Use when /instinct-status shows 20+ new observations since the last run, or after a multi-session work spurt. Conservative — only patterns with 3+ supporting observations become instincts.
origin: project
tools: Bash, Read, Write, Agent
---

# /evolve — Continuous Learning Phase 2 Extraction

Reads the project's observations.jsonl, spawns a Haiku subagent to detect behavioral patterns, and writes/updates atomic instincts in `~/.claude/instincts/projects/<hash>/instincts/personal/`.

## When to use

- After a few sessions of real work (run `/instinct-status` first to confirm 20+ new observations)
- After completing a story or epic, to capture habits that emerged
- When you suspect Claude is repeating the same correction across sessions

Do NOT run after every small task. The point is to extract patterns across sessions, not capture isolated events.

## Steps

### 1. Prepare the bundle

Run the prepare command. It checks the observation count, builds an extraction bundle (prompt + project context + existing instincts + memory + new observations), and prints JSON metadata.

```bash
node .claude/skills/continuous-learning/scripts/evolve.js prepare
```

The output JSON has:
- `ready: true|false` — whether enough observations accumulated
- `bundle_path` — the file to pass to Haiku
- `pending_path` — internal state file (do not touch)
- `total_observations` / `new_observations` / `bundled_observations` — counts
- `existing_instincts` — how many already exist
- `memory_loaded` — whether MEMORY.md was found and included

If `ready: false`, the message explains why (usually "not enough new observations"). Stop here and tell the user.

### 2. Show the user the bundle metadata

Display the prepare output to the user as a short summary, e.g.:

> Bundle prepared: 235 total observations, 235 new since last run, 200 sent to Haiku, 0 existing instincts, MEMORY.md loaded.

### 3. Spawn the Haiku extraction subagent

Use the Agent tool with `model: "haiku"` and `subagent_type: "general-purpose"`. The prompt instructs the subagent to read the bundle and output a single JSON object.

Dispatch prompt:

```
You are the Continuous-Learning Observer extraction subagent.

Read the file at the absolute path:
  {bundle_path}

It contains:
  - Your full instructions (read and follow them exactly)
  - Project context
  - Existing instincts (do not duplicate; update if pattern recurs)
  - The user's existing memory index (do not duplicate any patterns already captured there)
  - New observations to analyze

Output requirements:
  - A SINGLE valid JSON object on stdout
  - No markdown fences, no commentary, no extra text
  - Conform to the schema specified in the bundle
  - Be conservative — minimum 3 supporting observations per instinct
  - When in doubt, skip and increment skipped_count

Return only the JSON object as your final response.
```

Substitutions:
- `{bundle_path}`: the `bundle_path` from step 1's prepare output

### 4. Save the Haiku output to a file

Take the JSON object the subagent returned. Write it to:

```
~/.claude/instincts/projects/<project_id>/.evolve-output.json
```

Use the `project_id` from prepare's output. On Windows, the absolute path will look like:
`C:\Users\<user>\.claude\instincts\projects\<project_id>\.evolve-output.json`

Write the JSON object EXACTLY as the subagent emitted it (no reformatting, no parsing — the apply step does its own validation).

### 5. Apply

Run the apply command, passing the path to the JSON file:

```bash
node .claude/skills/continuous-learning/scripts/evolve.js apply <path-to-evolve-output.json>
```

It will:
- Validate each instinct (id format, confidence range)
- Write/update YAML files in `instincts/personal/`
- Preserve `created_at` on updates
- Advance the cursor (so future /evolve runs only see new observations)

The output JSON shows `created`, `updated`, `skipped`, and the list of files written.

### 6. Report to the user

Show a short summary:

> Extracted N new instincts, updated M existing, skipped K. Run `/instinct-status` to view them with confidence scores.

If any were created, recommend the user review them at `~/.claude/instincts/projects/<id>/instincts/personal/`. Memory is sacred; instincts are tentative — they should sanity-check before relying on them.

## Failure modes

- **`ready: false` from prepare** → not enough new observations. No action needed; report the count.
- **Haiku output is not valid JSON** → apply will fail with a parse error. Re-spawn the subagent with stricter "JSON only, no other text" instructions.
- **No instincts created** → Haiku found no patterns meeting the 3-observation threshold. This is fine. The cursor still advances so we don't re-analyze the same observations.
- **Bundle file missing on prepare** → likely a permission error or first-run init issue. Check `~/.claude/instincts/projects/<id>/` exists and is writable.

## Token cost note

Each /evolve run is roughly 10-15K Haiku input tokens (the bundle) + 2-3K output tokens. On the Claude Code subscription, this counts against your quota same as any subagent. Don't run it more than once or twice a day.

## What this does NOT do (deferred to later phases)

See `.claude/skills/continuous-learning/_next-phases.md` for the trigger conditions of:
- **Phase 2.5:** auto-trigger /evolve via Stop hook (after 2-3 manual runs prove valuable)
- **Phase 3:** surface instincts during sessions (after instincts/personal/ has useful content)
- **Phase 4:** /promote — halt-and-ask copy from instinct → memory/ (when you spot one worth elevating)
- **Clustering:** combine related instincts into evolved skills (only if pattern emerges naturally)
