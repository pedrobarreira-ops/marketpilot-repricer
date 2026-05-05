# Continuous-Learning Phase 2/3/4 — Build Plan

This file is a hand-off note from a prior session. Read it first when picking up the build, then re-fetch the ECC reference and re-read existing Phase 1 code before proposing architecture.

## Status as of 2026-05-05

- **Phase 1** (capture) is shipped — commit `8715d94`. The hook in `hooks/observe.sh` writes every PreToolUse + PostToolUse to `~/.claude/instincts/projects/<hash>/observations.jsonl`. Currently ~215 observations captured for this project. 5-layer self-loop guard is in place.
- **Phase 2, 3, 4** are NOT built. `/evolve` is referenced by `instinct-status/SKILL.md` and `instincts.js` but doesn't exist as a slash command anywhere.
- The commit message for `8715d94` is the canonical statement of what's deferred — read it (`git show 8715d94`) for the original author's intent.

## Goal

Convert the captured observations corpus into something useful at session time, integrated with Pedro's existing memory/ system. The system has zero value today — it captures but doesn't surface.

## What to build (commit-message scope, refined)

| Phase | Slash command | What it does |
|---|---|---|
| **Phase 2: Extract** | `/evolve` | Read `observations.jsonl`, spawn a Haiku subagent that proposes atomic instincts (patterns observed across N sessions). Emit each as a YAML file in `~/.claude/instincts/projects/<hash>/instincts/personal/` with `id`, `domain`, `pattern`, `confidence`, `sample_count`, `created_at`. |
| **Phase 3: Surface** | (no slash command) | Make instincts visible during normal sessions — likely via integration with the existing `memory/MEMORY.md` index OR a SessionStart hook that injects high-confidence instincts into the system prompt. **Decision needed at design time.** |
| **Phase 4: Promote** | `/promote` | High-confidence instincts get moved from `instincts/personal/` into Pedro's existing `memory/` directory (or `project-context.md` or a new skill — multi-target promotion is the project-specific work the original author flagged). |

## Key constraints (from Pedro's memory + CLAUDE.md)

- **No premature abstraction.** Build the simplest thing that works. Don't add framework features that "might be useful." See `feedback_no_premature_abstraction.md` in memory.
- **Integrate with existing memory system, don't replace it.** Pedro's `~/.claude/projects/<sanitized-cwd>/memory/MEMORY.md` already has hand-curated entries (project, feedback, reference, user types). Phase 4 promotion needs to *add* to that, not parallel it.
- **Use Haiku for extraction.** Per the existing `instincts.js` comment and ECC convention. Cheap inference for pattern surfacing.
- **Solo dev, non-developer user.** Pedro relies on AI for implementation. Surfaces should be plain-language; jargon is friction.
- **Don't bolt on ECC wholesale.** ECC ships 182 skills. We extract only what fits this project. Same discipline that produced the 30% bad/SKILL.md trim earlier today.

## Reference

- **ECC repo:** https://github.com/affaan-m/everything-claude-code
- **Specifically:** `skills/continuous-learning-v2/` (NOT `continuous-learning/` — that's the v1 we already partially borrowed from)
- **Slash commands of interest:** `/evolve`, `/instinct-import`, `/instinct-export`, `/prune`, `/instinct-status`
- **Anthropic SDK / Claude API:** Haiku invocations probably go via Agent tool with `model: "haiku"` — same pattern as BAD's `MODEL_STANDARD` dispatch.

## Existing surfaces to integrate with

- `.claude/skills/continuous-learning/scripts/instincts.js` — read-only CLI, already handles status/count/projects. Phase 2 likely extends this with extract/evolve/prune commands, or stays read-only and a separate script handles writes.
- `.claude/skills/instinct-status/SKILL.md` — already references `/evolve`. Update once `/evolve` exists.
- `~/.claude/projects/.../memory/MEMORY.md` — Pedro's existing hand-curated memory index. Phase 4 promotion target.
- `project-context.md` (this repo) — possible Phase 4 promotion target for project-wide patterns.

## What to AVOID

- Building a parallel memory system. Reuse `memory/`.
- Adding more SKILL.md descriptions to skill discovery (each costs always-loaded tokens — see today's `feedback_bad_skills_extract_subagent_prompts.md` work).
- Confidence scoring more sophisticated than "sample count + recency" until experience proves we need it.
- Auto-promotion to memory without Pedro confirming. Always halt-and-ask before writing to memory/.
- Surfacing instincts during sessions in a way that adds significant always-loaded context. The token math from today applies here too.

## Suggested first conversation in the post-compact session

1. Re-fetch ECC's `continuous-learning-v2` skill structure (WebFetch on the relevant tree URL).
2. Re-read this repo's `hooks/observe.sh` and `scripts/instincts.js`.
3. Run `node .claude/skills/continuous-learning/scripts/instincts.js status` to see current state.
4. **Propose architecture for Phase 2 first** — get Pedro's approval before building. Specifically: where does `/evolve` live (new skill? extension to instincts.js?), what's the Haiku prompt, what's the YAML schema, how often does it run?
5. Build Phase 2. Test against the 215 captured observations. See what surfaces.
6. Only after Phase 2 produces useful output: design Phase 3 (surfacing). Then Phase 4 (promotion).

Don't try to design all three phases up front. Phase 2's output will inform what Phase 3 actually needs.
