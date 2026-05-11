# Sprint Change Proposal — Story 6.3 PRI03 Parser Wire-Up & Counter Ownership

**Date:** 2026-05-09
**Author:** Pedro (request) + Bob (`bmad-correct-course` execution)
**Story affected:** `6-3-shared-mirakl-pri03-parser-js-per-sku-rebuild-semantics`
**PR:** [#85](https://github.com/) (open, Bundle C member, merge-blocked until Story 7.8)
**Worktree:** `.worktrees/story-6.3-pri03-parser-per-sku-rebuild/`
**Branch HEAD at correction time:** `5653abe`
**Scope classification:** **Minor** — direct adjustment within existing epic structure; no rollback, no MVP review, no replan

---

## Section 1 — Issue Summary

PR #85 shipped through the BAD pipeline (Steps 1–7) and passed all four review layers (Step 4 Test review, Step 5 Code review, Step 7 PR review, plus the standalone `/bad-review` audit on the merged PR). Despite passing every gate, `/bad-review`'s spec-grounded audit caught two issues that the inline review layers missed:

### Issue 1 — `scheduleRebuildForFailedSkus` is dead code in production

Story 6.3 spec **Dev Note 4** explicitly required this PR to update `shared/mirakl/pri02-poller.js` (Story 6.2's file) so the FAILED path of `clearPendingImport` invokes `scheduleRebuildForFailedSkus` after `fetchAndParseErrorReport` returns. The PR did not modify `pri02-poller.js`.

**Concrete bug state on `5653abe`:**

- `shared/mirakl/pri02-poller.js:253-263` calls `fetchAndParseErrorReport(baseUrl, apiKey, importId, tx)` — passing `tx` as the 4th argument.
- `shared/mirakl/pri03-parser.js:158` signature is `fetchAndParseErrorReport(baseUrl, apiKey, importId, lineMap)` — expects `lineMap` as 4th argument, NOT `tx`.
- The parser's loop `const shopSku = lineMap[lineNumber]` always returns `undefined` (`tx` is a `PoolClient` with no numeric keys), so the parser returns `failedSkus: []`.
- The poller never invokes `scheduleRebuildForFailedSkus` at all — no call site exists.

**Net effect:** the per-SKU rebuild semantics implemented and unit-tested (17 tests pass) in this PR have **never run in production**. Story 6.3's primary deliverable is dead code today.

### Issue 2 — Counter double-count latent bug

- `pri02-poller.js:225-246` increments `pri01_consecutive_failures` per cleared row in the FAILED path.
- `pri03-parser.js:361-370` (inside `scheduleRebuildForFailedSkus`) also increments `pri01_consecutive_failures` per failed SKU.
- Today only the poller fires (parser early-exits on undefined `lineMap` → empty `failedSkus` → never hits the increment).
- After the wire-up fix in Issue 1, **both will fire in the same FAILED transaction → counter doubles per cycle** — falsely triggering the 3-strike freeze on cycle 2 instead of cycle 3, silently corrupting the circuit-breaker semantics.

### Why this is structural, not a hotfix

The `lineMap` is generated transiently by `buildPri01Csv` (in `shared/mirakl/pri01-writer.js`, Story 6.1) at PRI01 submission time, used immediately for the multipart POST, and discarded. It is never persisted.

The `pri01_staging` schema (created by Story 5.2's migration `supabase/migrations/202604301214_create_pri01_staging.sql`) has columns: `id, customer_marketplace_id, sku_id, channel_code, new_price_cents, cycle_id, staged_at, flushed_at, import_id`. **No `csv_line_number` column.**

`pri01-writer.js:230` builds the CSV via `SELECT DISTINCT … FROM pri01_staging` with no `ORDER BY` — Postgres row order is non-deterministic, so the `lineMap` cannot be reconstructed from row order at PRI02 poll time either.

The fix therefore requires schema work + writer change + poller change + parser change + 3 new tests.

### Evidence

`/bad-review` verdict on PR #85 (key quotes):

> "scheduleRebuildForFailedSkus is never invoked from production code — the upstream poller (PR #84 pri02-poller.js) still calls only `fetchAndParseErrorReport(baseUrl, apiKey, importId, tx)` (passing `tx` as the fourth arg). Story spec Dev Note 4 explicitly required this PR to update the poller's FAILED path to call scheduleRebuildForFailedSkus after parsing. The diff does not modify pri02-poller.js."

> "Counter increment ownership ambiguity (poller vs parser) [shared/mirakl/pri02-poller.js:228-234 vs shared/mirakl/pri03-parser.js:363-370] — Both modules increment pri01_consecutive_failures in the same FAILED transaction. Today only the poller increments (parser early-exits on undefined lineMap); after the wire-up fix above, both will fire and the counter doubles per cycle."

---

## Section 2 — Impact Analysis

### Epic Impact

- **Epic 6 (PRI01 Writer Plumbing):** still `in-progress`. Stories 6.1, 6.2 stay at `review` (PRs #83, #84 unchanged). Story 6.3 rolls `review → atdd-done`. No epic-level scope change.
- **Bundle C atomicity gate (Story 7.8):** unchanged. PR #85 stays merge-blocked until Story 7.8 lands. The course correction does not alter the `merge_blocks` entry for Story 6.3.
- **Epic 7, 8, …:** no impact. The course correction lives entirely inside Story 6.3's worktree (PR #85 stacked diff naturally absorbs the cross-story file edits to `pri01-writer.js` and `pri02-poller.js` because PR #85 is stacked on PR #84 stacked on PR #83).

### Story Impact

- **Story 6.3:** **3 new acceptance criteria added (AC#5, AC#6, AC#7); 1 Dev Note added (Note 15 — counter ownership LOCKED); 1 Course-Correction Notes section added at top of Dev Agent Record; Files-to-Create table extended with new migration + writer/poller updates; Story Completion Checklist extended with course-correction subsection.**
- **Story 6.1, 6.2:** **No spec changes.** Files owned by these stories (`pri01-writer.js`, `pri02-poller.js`) are modified in Story 6.3's PR via Bundle C stacked-branch composition — the diffs naturally compose because PRs #83/#84/#85 form a stacked chain.
- **Story 5.2:** **No changes.** The new migration `202605091000_add_csv_line_number_to_pri01_staging.sql` ships in a NEW file; Story 5.2's `202604301214_create_pri01_staging.sql` is immutable.
- **Story 7.8 (atomicity gate):** unchanged. The end-to-end gate on all 17 P11 fixtures will exercise the now-real wire-up automatically once it runs.

### Artifact Conflicts

- **PRD distillate:** no conflict. FR23 (partial-success handling) is realized correctly post-correction; the original spec already aligned with FR23, the bug was an implementation gap, not a requirements conflict.
- **Architecture distillate:** no conflict. AD7 point 9 (PRI03 partial-success → per-SKU resubmit), AD12 (per-SKU freeze, Option b), AD24 partial (3-consecutive-failure escalation) are all realized correctly post-correction.
- **Epics distillate:** no conflict. Story 6.3's epic narrative is unchanged; the course correction adds implementation detail, not epic scope.
- **UX design:** no conflict. Story 6.3 has no UI surface.
- **Sprint-status.yaml:** ONE row updated (Story 6.3: `review → atdd-done` + course-correction comment). `merge_blocks` unchanged.

### Technical Impact

- **Schema:** one new migration file `202605091000_add_csv_line_number_to_pri01_staging.sql` (additive: nullable INTEGER column on `pri01_staging`).
- **Code touched in Story 6.3's PR (now expanded):**
  - `shared/mirakl/pri01-writer.js` (Story 6.1 file) — persist `csv_line_number` per row at flush
  - `shared/mirakl/pri02-poller.js` (Story 6.2 file) — query `lineMap`, pass to parser, invoke rebuild, retain counter increment
  - `shared/mirakl/pri03-parser.js` — drop counter increment (parser becomes read-only on the counter)
  - 3 new behavioral tests across `pri01-writer.test.js`, `pri02-poller.test.js`, `pri03-parser.test.js`
  - 1 repurposed test (`schedule_rebuild_increments_pri01_consecutive_failures_counter` → `parser_does_not_increment_counter`)
- **CI:** no pipeline changes. `npm run test:unit` continues to be the gate.
- **Deployment:** none — PR #85 stays merge-blocked.

---

## Section 3 — Recommended Approach

**Selected:** Option 1 — Direct Adjustment.

| Option | Verdict | Rationale |
|---|---|---|
| **1. Direct Adjustment** | **Selected** | Issue is solvable by adding 3 ACs to Story 6.3 + extending the cross-story diff that PR #85 already carries. Bundle C's stacked-branch model means the writer/poller changes ride in the same PR naturally. Effort: Medium. Risk: Low. Timeline impact: ~1 BAD pipeline pass on Story 6.3. |
| 2. Potential Rollback | Not viable | Rolling back PR #85 (or Stories 6.1 / 6.2) would force-rebase a stacked PR chain mid-Bundle. Bundle C's atomicity invariant is enforced by `merge_blocks`, not by sequential merging — rollback gains nothing and risks losing 17 unit tests + AC#1–4 work. |
| 3. PRD MVP Review | Not viable | MVP scope is unchanged. The bug is implementation-gap, not requirement-misunderstanding. Reducing scope makes no sense — the per-SKU rebuild is core to FR23. |

**Effort estimate:** Medium. One new migration (~5 lines), one writer modification (~10 lines + 1 test), one poller modification (~30 lines + 1 test), one parser deletion (~10 lines + 1 repurposed test). Total: ~50 net code lines + ~3 new behavioral tests. The dev-agent in BAD Step 3 should complete in the standard pipeline window.

**Risk assessment:** Low. All four files are in `shared/mirakl/` (same module boundary), all changes are inside an existing transaction (no new tx semantics), the counter-ownership invariant is locked and documented, and the migration is additive (nullable column).

**Timeline impact:** Story 6.3 rolls back one BAD step (review → atdd-done). The next `/bad` run picks it up under Phase 0's bundle-stacked exception, dispatches Step 3 onto the existing branch, and progresses through Steps 4-7 with full Opus rigor. Bundle C atomicity gate (Story 7.8) is untouched.

---

## Section 4 — Detailed Change Proposals

### 4.1 — Story 6.3 spec amendments

**File:** `.worktrees/story-6.3-pri03-parser-per-sku-rebuild/_bmad-output/implementation-artifacts/6-3-shared-mirakl-pri03-parser-js-per-sku-rebuild-semantics.md`

**Edits applied:**

1. **Course-Correction banner** (after the AD12 block, before `## Narrative`) — flags the rollback, lists the new ACs, points the dev agent at the Course-Correction Notes section. Status banner explicitly states PR #85 stays merge-blocked.
2. **AC#5** appended to the Acceptance Criteria section — Production wire-up of `pri02-poller → pri03-parser → scheduleRebuildForFailedSkus`. Specifies the SQL query for `lineMap` retrieval (`pri01_staging` JOIN `skus`, both `import_id` AND `customer_marketplace_id` predicates), the call signature `fetchAndParseErrorReport(baseUrl, apiKey, importId, lineMap)`, the rebuild invocation `scheduleRebuildForFailedSkus({tx, customerMarketplaceId, failedSkus, cycleId})`, and the behavioral test.
3. **AC#6** appended — `csv_line_number` persistence in `pri01_staging`. Specifies the new migration file `202605091000_add_csv_line_number_to_pri01_staging.sql`, the writer change (per-row UPDATE inside the same flush `tx`), and the new test.
4. **AC#7** appended — Counter ownership: poller owns. Specifies the parser-side deletion, the comment block, the poller-side retention, and the negative-assertion test.
5. **Dev Note 15** added at the end of "Dev Notes — Critical Implementation Details" — locks the counter-ownership decision with rationale (transport-error robustness for the circuit breaker). Explicitly marked LOCKED.
6. **Files to Create** table extended with the new migration row and the cross-story update bullets.
7. **Story Completion Checklist** extended with a "Course-Correction Tasks (2026-05-09)" subsection — additive, does not modify the original 26 checklist items.
8. **Course-Correction Notes (2026-05-09)** section added at top of `## Dev Agent Record` — narrates what was missed in the original ship, what's being added, the supersession map (AC#2 point 3 superseded by AC#7; Dev Note 4's `randomUUID()` superseded by AC#5's queried `cycleId`; original increment test repurposed), and the branch state.

### 4.2 — sprint-status.yaml flip on main

**File:** `_bmad-output/implementation-artifacts/sprint-status.yaml`

**Edit applied:**

```diff
-  6-3-shared-mirakl-pri03-parser-js-per-sku-rebuild-semantics: review  # ATOMICITY BUNDLE C (3/4 -- AD7 PRI03 parser + per-SKU rebuild); …
+  6-3-shared-mirakl-pri03-parser-js-per-sku-rebuild-semantics: atdd-done  # ATOMICITY BUNDLE C (3/4 -- AD7 PRI03 parser + per-SKU rebuild); … COURSE CORRECTION 2026-05-09 (bmad-correct-course): rolled review → atdd-done after /bad-review on PR #85 caught production wire-up gap (scheduleRebuildForFailedSkus dead code) + counter double-count latent bug — spec amended with AC#5 (poller→parser→rebuild wire-up), AC#6 (csv_line_number migration 202605091000 + writer persistence), AC#7 (counter ownership = poller, parser drops increment); Phase 0 bundle-stacked exception will pick it up; /bad will dispatch Step 3 onto existing branch (additive commits on 5653abe, no reset); PR #85 stays open, merge-block to 7-8 unchanged
```

`merge_blocks` entry for Story 6.3 unchanged (still `until_story: 7-8-…`).

### 4.3 — No code edits in this skill

`/bmad-correct-course` does NOT implement the code fix. The dev-agent in BAD's Step 3 owns implementation. This is by Pedro's explicit instruction:

> "DO NOT bypass BAD by implementing the code fix directly inside `/bmad-correct-course` — hand off to `/bad` for the actual code work, with full Step 3-7 review chain."

---

## Section 5 — Implementation Handoff

**Scope classification:** **Minor**.

**Routing:** Re-dispatch to `/bad`.

**Handoff plan:**

1. **Pedro reviews this proposal** and approves (or revises).
2. **Pedro commits the spec edits + sprint-status flip** (or BAD's Phase 0 reconciler picks up the sprint-status flip on the next `/bad` run; the spec edit lives in the worktree and will be picked up by Step 3 dev-agent automatically).
3. **Pedro runs `/bad`.** Phase 0's bundle-stacked exception finds Story 6.3 at `atdd-done` with PR open (#85). The coordinator dispatches Step 3 (Develop) onto the existing branch.
4. **BAD Step 3 (dev-agent)** reads the amended spec, applies the AC#5 / AC#6 / AC#7 changes as additive commits on `5653abe`. No reset, no force-push.
5. **BAD Steps 4-7** review the new commits with full Opus rigor (Test review, Code review, PR-body refresh, PR review). New tests added by the course correction become part of the regression suite for these steps.
6. **PR #85 stays merge-blocked until Story 7.8 lands** (`merge_blocks: 6-3 → 7-8`). Course correction does NOT alter that.
7. **Bundle C eventually merges as one coherent unit** when Story 7.8 lands its atomicity-gate test green across all 17 P11 fixtures. The course-correction work ships with it.

**Success criteria:**

- All 4 originally-passing AC#1-4 tests still pass.
- All 3 new course-correction tests (`csv_line_number_persisted_after_flush`, `pri02_failed_invokes_parser_and_rebuild_with_real_lineMap`, `parser_does_not_increment_counter`) pass.
- The repurposed test (`parser_does_not_increment_counter`, formerly `schedule_rebuild_increments_pri01_consecutive_failures_counter`) inverts cleanly.
- `npm run test:unit` passes with no new pre-existing-failure regressions beyond the known 22 from Story 6.1's forward-dependency.
- `/bad-review` re-run on the post-correction PR #85 reports no production wire-up gaps.
- Story 7.8's eventual end-to-end gate exercises the now-real wire-up across all 17 P11 fixtures.

**Out of scope for this proposal:**

- Merging PR #85 to main (blocked until 7.8).
- Modifying Story 5.2's existing migration (immutable).
- Reopening the counter-ownership decision (LOCKED — see Dev Note 15).
- Implementing the code fix inside `/bmad-correct-course` (handoff to `/bad`).

---

## Approval

Pending Pedro's explicit approval before final handoff. Per the workflow's Step 5: "Must have explicit approval before implementing changes."

Status after approval: classified Minor → routed to BAD pipeline for re-dispatch.
