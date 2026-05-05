# Continuous-Learning Next Phases — Trigger Conditions

This document lives next to `_phase-2-plan.md` (the bridge note that survived the compaction we used to build Phase 2). Its purpose: capture *trigger conditions* — not calendar reminders — for the work deferred from Phase 2.

If you're reading this you've probably either run `/evolve` and want to know what's next, or you're picking up the system after a gap. Read top to bottom — the phases are listed in the order they naturally trigger.

---

## Status as of 2026-05-05 (Phase 2 ship)

- **Phase 1** (capture, hooks/observe.sh) — shipped, commit `8715d94`
- **Phase 2** (extract, /evolve) — shipped this session
  - First run: 0 instincts created (200 observations dominated by a single session whose pattern was already in MEMORY.md)
  - Cursor advanced to 279
  - System validated end-to-end: prepare → Haiku → apply → cursor advance

The next phases are listed below in the order their *triggers* will naturally fire as you use the system more.

---

## Phase 2.5 — Stop-hook auto-trigger for `/evolve`

**Trigger condition:** You've manually run `/evolve` 2-3 times across different work spurts AND at least one of those runs produced an instinct YOU agreed was useful.

**Why this trigger:** Until you've validated that /evolve produces output you trust, automating it just produces more noise faster. Once you've seen good output from the manual flow, the automation is low-risk.

**What to build (~10-30 min):**

1. Create `.claude/skills/continuous-learning/hooks/maybe-evolve.sh`
2. The script:
   - Reads cursor + current observation count
   - If `current - cursor >= 50` (configurable) AND no `.evolve-bundle.md` already exists
   - Runs `evolve.js prepare`, then notifies via the hook's `systemMessage` JSON output that user should run `/evolve` to extract
3. Register the hook on the `Stop` event in `.claude/settings.json`
4. The hook does NOT spawn Haiku itself — that's a quota cost and timing risk on Stop. It just *prepares* and *signals*.

**What NOT to do:**
- Don't have the Stop hook spawn Haiku. The Stop event is supposed to be cheap; spawning a subagent there can stall the user's next turn.
- Don't poll on a daemon (ECC's `observer-loop.sh`). Cross-platform pain on Windows, daily quota waste, harder to debug.

**Self-check before shipping:** Run a session, hit Stop, confirm the systemMessage appears AND the bundle was prepared AND running /evolve as the next action picks up from where Stop left off.

---

## Phase 3 — Surface instincts during sessions

**Trigger condition:** `instincts/personal/` has accumulated 5+ instincts at confidence ≥0.7 AND you've found yourself manually checking them before sessions.

**Why this trigger:** Surfacing burns always-loaded context tokens (the same surface we just spent a session trimming). Don't pay that cost until you have content worth surfacing.

**Architecture decisions to make then (don't pre-decide now):**

| Decision | Options |
|---|---|
| Where to surface | (a) inject into system prompt via SessionStart hook (b) write to project-context.md (c) write to a separate skill body (d) just rely on Haiku reading instincts/personal/ in a future /evolve cycle |
| How many | Top-N by confidence? All ≥0.7? All? |
| Filter by domain | Always show all? Or context-aware (e.g. only `mirakl` domain when editing Mirakl files)? |
| Update cadence | Re-inject on every session start? Only when /evolve produces new ones? |

**Likely best path** (subject to seeing actual instinct content):
- SessionStart hook → reads top 3-5 instincts by confidence → injects into context via `hookSpecificOutput.additionalContext`
- This is conditional, cheap, and doesn't pollute always-loaded skill descriptions
- See update-config skill in this repo for SessionStart hook syntax

**What NOT to do:**
- Don't add instinct descriptions to skill discovery (always-loaded cost — see today's BAD/bad-review extraction work)
- Don't auto-inject instincts at confidence <0.7 — too tentative to trust as default
- Don't surface dozens at once — context budget kills the value

---

## Phase 4 — `/promote`: instinct → memory

**Trigger condition:** You spot a specific instinct you wish were in your MEMORY.md (always-loaded context across all conversations).

**Why this trigger:** Memory is sacred. Auto-promotion at confidence threshold (even 0.95) is dangerous because confidence measures *frequency*, not *correctness*. Halt-and-ask on every promotion.

**What to build (~30-60 min):**

1. New skill: `.claude/skills/promote/SKILL.md`
2. Slash command: `/promote <instinct-id>` OR `/promote` (lists candidates)
3. Steps:
   - Read the instinct YAML
   - Compose a candidate MEMORY.md entry + a candidate body file (per the auto-memory format in CLAUDE.md / system prompt)
   - SHOW the candidate to user with a diff
   - User confirms (yes/edit/no)
   - On yes: write the body file to `~/.claude/projects/<sanitized-cwd>/memory/<type>_<topic>.md`, append the index line to `MEMORY.md`
   - On confirm: optionally archive the source instinct (move to `instincts/promoted/`) so it doesn't surface elsewhere

**Halt-and-ask is non-negotiable:**
- Memory entries persist forever and are loaded into every conversation
- A bad memory entry pollutes every future Claude response until you delete it
- High instinct confidence = "I saw this N times". It does NOT mean "this is correct"

**Auto-archive is optional:** Some users prefer to keep promoted instincts visible alongside memory; others find it noisy. Decide based on preference once you've promoted 2-3.

---

## Clustering — instincts → evolved skills

**Trigger condition:** `instincts/personal/` has accumulated 15+ instincts AND a clear cluster of 4-6 related ones doesn't fit naturally as memory entries (e.g. a multi-step workflow that's too procedural for memory).

**Why this trigger:** Memory is for facts and atomic guidance. A 6-step workflow with conditional branches doesn't compress into a memory entry well — it WANTS to be a skill body. But until you have a real cluster, designing the clustering output is speculation.

**What to build (when triggered):**

- Extend `evolve.js` with a `cluster` subcommand
- Spawn Haiku again, this time over `instincts/personal/` (not observations)
- Output: candidate skill files in `.claude/skills/evolved/<name>/SKILL.md`
- Halt-and-ask before adopting: each new skill costs always-loaded discovery tokens

**Don't pre-build this.** The shape of useful clusters is unknowable until the instincts exist.

---

## Cross-project promotion — single-project, not relevant yet

ECC's flow promotes project instincts → global instincts when the same instinct appears in 2+ projects with avg confidence ≥0.8. You currently have one project (marketpilot-repricer) so this can't fire.

**Trigger condition:** When you start working on your second project (likely a future MarketPilot consulting client repo or a related tool) AND that project's continuous-learning system observes for a few sessions.

The implementation is straightforward when needed — `evolve.js` would gain a `--check-global` flag that compares instinct IDs across projects. But: don't build for this until the second project exists.

---

## Living document

Update this file when:
- A trigger fires and the phase ships → mark it shipped, add the actual implementation date
- A trigger condition turns out to be wrong (e.g. you wanted Phase 3 sooner than the trigger suggested) → update the trigger and write a one-line *Why:* explaining what changed
- You decide a phase isn't worth building → delete its section entirely

Don't let this doc drift into a wishlist — it should always reflect *next concrete things to build, with explicit triggers*.
