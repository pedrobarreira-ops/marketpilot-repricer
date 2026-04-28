# Audit Checklist — what each subagent looks for

Reference for the 4 parallel audit subagents. These are the specific checks that caught real bugs across Epic 3. When adding checks, prefer concrete "have we seen this before" patterns over generic "review everything".

---

## Subagent A: Code vs spec

**Primary job:** map each AC to its implementation and report satisfied / deviated / missing.

**Specific things to catch (proven from Epic 3):**

1. **Unchecked task lists in the story spec** — if the spec shows `[ ]` for tasks BAD claims to have completed, something's wrong with Step 3 / Step 7 bookkeeping. Minor but worth flagging.
2. **"Verified by" pointing at an ATDD file that was modified** — the "DO NOT MODIFY" convention leaked twice in Epic 3 (3.3, 3.7). Sometimes justified (the test was wrong), but always worth flagging.
3. **Scope creep** — code adds functionality the spec didn't ask for. BAD's PR body might invent features that are actually in code (e.g. 3.6 email retry that was promised in body but not in code = hallucination; if it had been real, that would be scope creep).
4. **Missing AC** — an acceptance criterion has no corresponding code. Common when the spec contradicts Mirakl MCP reality and the dev silently skipped it (3.2 tried to use `state === 'ACTIVE'` → dev switched to `active === true` without updating spec).
5. **Return shape mismatch** — function returns `summary_pt` + `summary_es` separately but spec describes `summary: {pt, es}`. Not a bug but a downstream seam (caught in 3.4, handled in 3.5).

**Output:** AC Coverage table + Scope creep bullets + Contradictions bullets + one-line verdict.

---

## Subagent B: MCP alignment

**Primary job:** grep target files for known-stale Mirakl patterns, confirm correct patterns are used instead.

**The five forbidden patterns** (see `mcp-forbidden-patterns.md` for full context):

| # | Bad | Good |
|---|-----|------|
| 1 | `state === 'ACTIVE'` | `offer.active === true` |
| 2 | `product_ids: <EANs>` | `product_references=EAN\|xxx` |
| 3 | `offer.channel_code === 'WRT_*'` | bucket by which per-channel P11 call returned offer |
| 4 | `offer.price` alone for competitor | `offer.total_price` (+ `pricing_channel_code` in query) |
| 5 | `activeOffers.length !== total_count` | `allOffers.length !== total_count` (pre-filter) |

**Additional checks:**

- **New endpoint references** — if code imports or calls any Mirakl endpoint not in the MCP-Verified Reference table (OF21, P11, PRI01, PRI02, PRI03), flag for live probe.
- **New field/param access** — if code reads `offer.<something>` or passes a `<param_name>` not documented in the MCP-Verified Reference, flag.

**Output:** Forbidden-pattern grep results + correct-pattern confirmation + new-endpoint flags + one-line verdict.

---

## Subagent C: Test quality

**Primary job:** classify tests as behavioral vs keyword-grep vs skeleton; flag critical gaps.

**Classification rules:**

- **Behavioral** — calls the implementation function with fixtures, asserts on return value / state / mock call args. Example: `const result = computeReport([{price:10}], new Map([['123',{pt:{first:9}}]])); assert.equal(result.opportunities_pt.length, 1)`.
- **Keyword-grep** — reads source file as text via `readFileSync`, asserts `src.includes('...')`. Weak — only verifies the keyword appears.
- **Skeleton** — `assert.equal(typeof fn, 'function')` or `assert.ok(fn)`. Very weak.

**Classification thresholds:**

- **Strong** — ≥50% behavioral AND includes at least one supplementary `.additional.test.js` or `.unit.test.js` file.
- **Acceptable** — ≥20% behavioral, OR all keyword-grep but with an `.additional` supplement adding behavioral coverage.
- **Weak** — mostly keyword-grep, no behavioral supplement. This was the state of Stories 3.2 and 3.3 ATDD — and three silent bugs made it through.

**Critical gaps to flag** (the ones that catch real issues):

- **Security invariants** — is there a test asserting `api_key` never appears in log output? `err.message` never logged? These are the invariants that *must* have runtime coverage, not just static scans.
- **Error paths** — what if the dependency throws? Tested or just happy-path?
- **Edge cases** — empty input, null, boundary values. Especially important for math (scoring) and parsing (CSV, EAN extraction).
- **Contract with downstream** — does the test assert the return shape matches what the next story consumes? (3.4's `summary_pt`/`_es` separately vs `summary:{pt,es}` nested.)

**Output:** Classification totals + behavioral% + critical-gaps bullets + verdict.

---

## Subagent D: PR body vs diff

**Primary job:** catch BAD Step 6 hallucinations.

**Context:** BAD's PR body generator fabricates plausible-but-fictional implementation detail ~50% of the time (3.5 and 3.6 bodies had hallucinations; 3.4 and 3.7 didn't). The diff is source of truth; the body is decorative.

**Common hallucination categories to check:**

1. **Filenames** — "Adds src/foo.js" when no such file is in the diff.
2. **Table / column names** — "writes to report_items table" when the schema has no such table.
3. **Config flags / env vars** — "honors EMAIL_ENABLED env flag" when no such env var is read in the code.
4. **Behavioral claims** — "retry with exponential backoff", "attachment support", "plain-text body fallback" — all common BAD inventions that weren't actually implemented.
5. **Test counts** — sometimes inflated; verify `npm test` actually runs the claimed number.

**What to ignore (noise):**

- General prose: "implements the story", "adds tests", "fixes the bug".
- Standard template boilerplate: "Fixes #N", "🤖 Generated with Claude Code".
- Test-plan checklists that aren't factual claims (they're aspirational).

**Output:** Claims-vs-diff table + body-accuracy verdict (Accurate / Partial / Hallucinated).

---

## How the verdicts compose into an overall recommendation

| Subagent outcomes | Overall verdict | Action |
|-------------------|-----------------|--------|
| All 4 green | **Safe to merge** | Offer [M]erge |
| Test quality = Weak OR body = Hallucinated (everything else green) | **Merge with awareness** | Offer [M]erge but note the weakness |
| Code vs spec = Blocking issues OR MCP = Drift found | **Needs fixes first** | Do not offer [M]erge; offer [F]ix / [S]top |
| Mixed minor issues | **Use judgment** | Present the details, let user decide |

**Default bias:** when in doubt, lean toward "Needs fixes first". A 10-minute fix on a branch is cheaper than a post-merge cleanup.

---

## What NOT to do in the audit

1. **Don't re-derive the Mirakl API truth** — the `mcp-forbidden-patterns.md` file is authoritative for known patterns. Don't consult the live MCP again from subagents; that wastes tokens.
2. **Don't read every file in the repo** — subagents get the target file list from Phase 1. Stay within those files.
3. **Don't run tests from the subagents** — the main context does that in Phase 5. Subagents only read code + spec + existing test files.
4. **Don't speculate about future epics** — audit only what's in this PR. Future-proofing is Phase 3 synthesis work.
5. **Don't adjust the PR body** — only report what's wrong with it. The reviewer decides whether to fix the body or ignore it.
