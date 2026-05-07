# Subagent C: Test Quality — Audit Instructions

The coordinator's dispatch prompt provides:
- `{TEST_FILES}` (list of test files: ATDD, .additional, .unit)
- `{CODE_FILES}` (implementation files — used to detect critical-path)

The coordinator selects the model based on whether ANY file in `CODE_FILES` is critical-path (Sonnet by default; Opus when critical-path).

---

Classify each test() call:
- BEHAVIORAL: calls the actual implementation with fixtures; asserts on
  return value, state change, or mock call args.
- KEYWORD-GREP: reads the implementation file as text; asserts
  src.includes('...') or regex patterns against source.
- SKELETON: asserts export existence, function type, class name only.

CRITICAL-PATH detection: a file is critical-path if its path starts with any
of: `worker/src/`, `app/src/routes/`, `app/src/middleware/`, `shared/mirakl/`,
`shared/audit/`, `shared/state/`, `shared/money/`, `shared/crypto/`,
`supabase/migrations/`. If ANY file in CODE_FILES is critical-path, this PR
is critical-path and the stricter thresholds below apply.

For critical-path PRs, additionally check **fixture binding**: every fixture
filename referenced in the test files (e.g., `p11-tier1-undercut-succeeds.json`,
`pri01-csv/single-channel-undercut.csv`) must have at least one BEHAVIORAL
test that loads the fixture and asserts on the result. List any unbound fixtures.

Report:

## Test classification
- N behavioral / M keyword-grep / K skeleton (total: N+M+K)
- Behavioral %: X%

## Fixture binding (critical-path PRs only — omit section otherwise)
- Fixtures referenced: {list}
- Fixtures with ≥1 behavioral binding: {list}
- Unbound fixtures: {list or "none"}

## Cross-story RLS test compatibility (run when CODE_FILES includes supabase/migrations/)

If the PR adds or removes RLS policies on any table, grep `tests/` for
existing assertions about that table's policies:
```bash
grep -rn "tablename = 'TABLE_NAME'" tests/
grep -rn "policyname.*TABLE_NAME\|TABLE_NAME.*polic" tests/
```
For each match found, check whether the new policy contradicts the assertion
(e.g. a test that asserts zero modify policies will break if an INSERT policy
was added). List any conflicts as a **critical gap** — they will break CI for
all subsequent PRs on main.

(Root cause: Story 4.3 added `scan_jobs_insert_own` without updating Story 4.2's
test asserting zero modify policies — CI failed on all three subsequent PRs,
2026-05-07.)

## Critical gaps
List checks that SHOULD exist but don't, focused on:
- Security invariants (no api_key leak, no err.message in logs)
- Error paths (what if the dependency throws?)
- Edge cases (empty input, null, boundary values)
- Atomicity / state-machine invariants for state-touching code
Use your judgement on what "critical" means for the specific code.

## Verdict

For critical-path PRs (stricter):
- Strong: ≥80% behavioral, no critical gaps, every named fixture bound.
- Acceptable: ≥50% behavioral, no critical gaps, every named fixture bound (some keyword-grep tolerated as supplements).
- Weak: <50% behavioral OR any unbound fixture OR any critical gap.

For non-critical-path PRs (legacy thresholds):
- Strong: ≥50% behavioral, no critical gaps.
- Acceptable: ≥20% behavioral OR has .additional supplement.
- Weak: mostly keyword-grep, no behavioral supplement.

State explicitly which threshold set you applied (critical-path / standard).

Stay under 350 words.
