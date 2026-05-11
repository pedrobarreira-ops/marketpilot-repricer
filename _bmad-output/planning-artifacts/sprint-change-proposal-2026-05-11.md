# Sprint Change Proposal — 2026-05-11

**Trigger:** Story 7.8 Bundle C atomicity gate — Step 7 adversarial review surfaced 4 concrete findings; subsequent verification confirmed all 4 hold. Gate as implemented does NOT gate Bundle C.
**Triggering story:** 7-8-end-to-end-integration-gate-full-cycle-test-on-all-17-p11-fixtures-atomicity-bundle-gate-for-ad7-ad8-ad9-ad11
**Issue type:** Misunderstanding of original requirements (spec was internally contradictory; implementation correctly followed contradictory spec)
**Scope classification:** Moderate — single-story spec rewrite + branch-topology recovery + future-bundle process amendment. No epic-scope or PRD-scope changes.
**Author:** Bob (SM) — ruling delivered 2026-05-11 post-Pedro adversarial-review verification.

---

## Section 1 — Issue Summary

Story 7.8 was sharded 2026-05-11 as the terminal atomicity gate for Bundle C (Stories 5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.6). It passed all 7 BAD pipeline steps and reached Step 7 review. Pedro ran adversarial review on PR #90 which surfaced 4 findings; Pedro then verified each finding holds.

**Verified findings (against `.worktrees/story-7.8-.../tests/integration/full-cycle.test.js`):**

| # | Finding | Evidence |
|---|---------|----------|
| F1 | Dead assertion variables — AC2 claims "pri01_staging tracked" but only asserts `result.action` + `result.newPriceCents`. PRI02 COMPLETE clear is tautological (test calls own mock directly). | full-cycle.test.js:393 (declaration), :399 (push), :434-448 (replaced asserts with engine-result-shape checks); circuit-breaker-trip.test.js:124, :137-141 (unreachable else branch) |
| F2 | `p11-cooperative-absorption-anomaly-freeze` test expects `HOLD` with author rationalization comment acknowledging real behavior is `SKIP` | full-cycle.test.js:266-279 ("acceptable transient behavior for this branch") |
| F3 | Integration tests are unit tests — direct module imports, no HTTP, no real `transitionCronState`, no real Mirakl mock-server use | full-cycle.test.js:36 (direct import of `decideForSkuChannel`); no import of `tests/mocks/mirakl-server.js` anywhere in `tests/integration/` |
| F4 | Fixture `_expected` metadata is decorative — `loadFixture` returns 4 keys, consumer destructures only 2; hand-coded `tc.expectedAction` table is the oracle | full-cycle.test.js:50-59 (loadFixture), :327 (`const { offers, note }`) |

**Root cause:** Story 7.8 spec is internally contradictory.

- Line 3 references `tests/mocks/mirakl-server.js` as the mock layer — but the integration tests don't use it (they call engine modules directly, which is the right design for pure-logic invariants).
- Line 34 asserts "ALL Bundle C code is present in this worktree."
- Lines 58-67 caveat that 4 modules (`cooperative-absorb.js`, `tier-classify.js`, `anomaly-freeze.js`, `reconciliation.js`) "MAY NOT be on this branch" because of bundle dispatch topology.
- Line 67 authorizes: *"For missing modules, the integration tests MUST inject mock implementations or use the stub-fallback approach."*

The dev followed orders. The orders contradicted themselves and authorized their own evasion.

**Branch topology underlying the contradiction:**

```
5.1 → 5.2 → 6.1 → 6.2 → 6.3 → 7.2 → 7.6 → 7.8  (linear stack)
                                ↘
                                 7.3              (parallel dispatch — NOT stacked)
```

7.3 was dispatched in parallel from 7.2 rather than stacked. The 7.8 worktree forked from 7.6 (which stacks on 7.2), so 7.8 missed `cooperative-absorb.js`. This is the single divergence point in Bundle C topology.

---

## Section 2 — Impact Analysis

**Epic impact (Epic 7):** Epic 7 stays as planned. 7.8 stays a story in Epic 7. No epic-level changes.

**Story impact:**
- Story 7.8 — spec amended (this proposal). Existing worktree + branch + PR #90 to be destroyed during recovery ops.
- Stories 5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.6 — no spec changes. Their PRs (#81-#85, #87-#89) stay open and merge-blocked on 7.8 done, per existing `merge_blocks` block in sprint-status.yaml.

**Artifact conflicts:**
- PRD — no conflict. No requirement changes.
- Architecture — no conflict. AD7/AD8/AD9/AD11 are unchanged.
- UX — N/A (no UI in this story).
- Epics distillate — no conflict. Bundle C definition stays.
- `sprint-status.yaml` — no `development_status` change (7.8 stays `review` until BAD re-dispatches). Optional future change: add `bundle_dispatch_orders:` top-level block when BAD dispatcher patch lands (deferred to Epic 7 retro per Bob's ruling).
- `bad/SKILL.md` — dispatcher rule patch (Q3+Q4 from ruling) deferred to Epic 7 retro per Bob's ruling. Recovery operations do NOT depend on the patch.

**Technical impact:**
- One git merge across disjoint files (`worker/src/engine/cooperative-absorb.js` is the only file 7.3 ships) → synthetic `bundle-c-integrated` branch.
- Destruction of `.worktrees/story-7.8-...` (worktree + branch). Reversible from reflog within 90 days.
- PR #90 closed with explanatory comment. New PR auto-created by BAD on re-dispatch.

---

## Section 3 — Recommended Approach

**PATH B.2 — Extend existing stack chain, rebuild 7.8 worktree, re-author spec.**

Rationale (Pedro and Bob aligned 2026-05-11):

1. PATH A (merge first, gate after) was rejected — surrenders the atomicity invariant Bundle C exists to protect. If gate fails post-merge, 8 PRs of broken code on main.
2. PATH B as originally framed (cherry-pick or merge all 8 PR branches) over-described the work. Bundle C is already 88% linearly stacked; only the 7.3 divergence needs repair.
3. PATH B.2 is one merge (7.3 into 7.6 tip → `bundle-c-integrated`), then fresh /bad dispatch of 7.8 forking from the integrated branch.

**Mock-server design call (Pedro 2026-05-11):** SKIP. AD7+AD8+AD9+AD11 are pure-logic invariants (transactional atomicity, decision-table correctness, skip-on-pending precondition, CB thresholds). HTTP layer adds no signal. Direct-module-import + real-tx + real-modules + real `markStagingPending` + real `transitionCronState` is sufficient. Spec line 3 mock-server reference was aspirational; remove it.

**Effort:** Low (one merge + spec rewrite + one BAD re-dispatch). 1-2 day calendar elapsed.
**Risk:** Low — single-file merge across disjoint changes; recovery ops reversible; spec amendments codified in this doc.

---

## Section 4 — Detailed Change Proposals

All 9 amendments target the Story 7.8 spec file. Since the existing worktree will be destroyed during recovery ops, the amended spec is regenerated via fresh `/bmad-create-story` (or direct file write) once `bundle-c-integrated` exists. This SCP doc is the authoritative source for the next dispatch's spec content.

### Amendment 1 — Replace line 3 mock-server claim

**Section:** Header note (line 3)

**OLD:**
```
> No Mirakl API endpoints are called by this story — the mock server (`tests/mocks/mirakl-server.js`) intercepts all Mirakl calls. No MCP verification required for this story.
```

**NEW:**
```
> No Mirakl API endpoints are called by this story. AD7+AD8+AD9+AD11 are pure-logic invariants — the gate exercises real production modules with a real mock tx, no HTTP layer. No Mirakl mock server, no MCP verification.
```

**Rationale:** Mock-server reference was aspirational; no integration test ever imported it. Direct-module-import is the right pattern for pure-logic atomicity invariants.

---

### Amendment 2 — Rewrite "Bundle C Gate Context" (lines 32-38)

**Section:** Bundle C Gate Context (paragraph after Trace)

**OLD:**
```
Story 7.8 is the **terminal gate** for Bundle C — the atomicity bundle spanning Stories 5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.6. The bundle spans four separate PRs (#81 through #89, all currently in review, not yet merged). This story's worktree forks from the Story 7.6 branch (which itself includes Story 7.2 code via stacking), so ALL Bundle C code is present in this worktree.

**Bundle C invariant to gate:** When a PRI01 batch is submitted, EVERY `sku_channel` row participating in that batch (including passthrough lines in delete-and-replace semantics) has `pending_import_id = <import_uuid>` set in a single transaction. PRI02 COMPLETE clears all rows atomically. Cooperative-absorption skip-on-pending and engine STEP 1 precondition both depend on this atomicity.

**What "gate passing" means:** All three integration test files pass cleanly. Only then does Epic 6's writer code become safe to merge to main.
```

**NEW:**
```
Story 7.8 is the **terminal gate** for Bundle C — the atomicity bundle spanning Stories 5.1, 5.2, 6.1, 6.2, 6.3, 7.2, 7.3, 7.6. The bundle spans 8 separate PRs (#81-#85, #87-#89, all in review, all merge-blocked on this gate). This story's worktree forks from `bundle-c-integrated` (synthetic branch: `story-7.6-...` head merged with `story-7.3-...`). **ALL 8 Bundle C modules are present and the test suite MUST use REAL imports of every production module — no stubs, no fallbacks, no mocks for any production code.**

**Bundle C invariant to gate:** When a PRI01 batch is submitted, EVERY `sku_channel` row participating in that batch (including passthrough lines in delete-and-replace semantics) has `pending_import_id = <import_uuid>` set in a single transaction. PRI02 COMPLETE clears all rows atomically. Cooperative-absorption skip-on-pending and engine STEP 1 precondition both depend on this atomicity.

**What "gate passing" means:** All three integration test files pass cleanly, with the real `cooperative-absorb.js` + real `circuit-breaker.js` + real `markStagingPending` + real `clearPendingImport` + real `transitionCronState` exercised. Only then does Bundle C become safe to merge to main.
```

**Rationale:** Removes "ALL Bundle C code is present" claim that was undermined by the "MAY NOT be on this branch" caveats. Replaces with categorical "all 8 modules present, all real imports mandatory." Also corrects PR-range from "#81-#89" (which included gaps) to the explicit list.

---

### Amendment 3 — Replace "IMPORTANT — Branch Topology" (lines 58-67)

**Section:** Dependencies > IMPORTANT — Branch Topology

**OLD:**
```
**IMPORTANT — Branch Topology:**
This worktree forks from `story-7.6-worker-src-safety-circuit-breaker-js-per-sku-15-per-cycle-20`. Story 7.6 was stacked on Story 7.2 (not on Story 7.3). Therefore:
- `worker/src/engine/decide.js` IS on this branch (Story 7.2)
- `worker/src/safety/circuit-breaker.js` IS on this branch (Story 7.6)
- `worker/src/engine/cooperative-absorb.js` **MAY NOT be on this branch** (Story 7.3 was dispatched in parallel, not stacked)
- `worker/src/engine/tier-classify.js` **MAY NOT be on this branch** (Story 7.5, separate worktree)
- `worker/src/safety/anomaly-freeze.js` **MAY NOT be on this branch** (Story 7.4)
- `worker/src/safety/reconciliation.js` **MAY NOT be on this branch** (Story 7.7)

**Before implementing tests:** Run `ls worker/src/engine/` and `ls worker/src/safety/` to verify which modules are present. For missing modules (cooperative-absorb, tier-classify, anomaly-freeze, reconciliation), the integration tests MUST inject mock implementations or use the stub-fallback approach documented in `worker/src/engine/decide.js` and `worker/src/cycle-assembly.js`.
```

**NEW:**
```
**IMPORTANT — Branch Topology:**
This worktree forks from `bundle-c-integrated` — a synthetic branch created by merging `story-7.3-worker-src-engine-cooperative-absorb-...` into the head of `story-7.6-worker-src-safety-circuit-breaker-...`. All 8 Bundle C modules are present:

- `worker/src/dispatcher.js`, `worker/src/advisory-lock.js` (Story 5.1)
- `worker/src/cycle-assembly.js` (Story 5.2)
- `shared/mirakl/pri01-writer.js` (Story 6.1)
- `shared/mirakl/pri02-poller.js`, `worker/src/jobs/pri02-poll.js` (Story 6.2)
- `shared/mirakl/pri03-parser.js` (Story 6.3)
- `worker/src/engine/decide.js` (Story 7.2)
- `worker/src/engine/cooperative-absorb.js` (Story 7.3)
- `worker/src/safety/circuit-breaker.js` (Story 7.6)

Stories 7.4 (anomaly-freeze), 7.5 (tier-classify), 7.7 (reconciliation) are NOT Bundle C members — their absence is structural and expected. Tests for those modules' behavior live in their own stories, not in this gate.

**Before implementing tests:** Verify all 8 Bundle C modules are present (`ls worker/src/engine/`, `ls worker/src/safety/`, `ls shared/mirakl/`). If any Bundle C module is absent, this is a DISPATCH ERROR — halt and escalate to Pedro/Bob. Stub-fallbacks for production modules are FORBIDDEN. The test MUST import the real module.
```

**Rationale:** Eliminates the "MAY NOT be on this branch" framing that authorized the broken implementation. Categorical: all 8 present, escalate if not. Also clarifies the non-membership of 7.4/7.5/7.7 (which were sometimes conflated with Bundle C in the prior framing).

---

### Amendment 4 — Tighten AC1 (lines 389-401)

**Section:** Acceptance Criteria > AC1

**OLD:**
```
### AC1 — `tests/integration/full-cycle.test.js` — 17-fixture parametric cycle test

**Given** `tests/integration/full-cycle.test.js` exists
**When** I run `node --test tests/integration/full-cycle.test.js`
**Then**:
- For each of the 17 P11 fixtures (load from `tests/fixtures/p11/`), the test:
  1. Instantiates a mock tx tracking `pri01_staging` INSERTs and audit_log writes
  2. Calls `decideForSkuChannel` directly from `worker/src/engine/decide.js` with the fixture's P11 offers + appropriate `skuChannel` / `customerMarketplace` mock objects (or calls `assembleCycle` with injected engine)
  3. Asserts the `action` returned matches the fixture's documented expected action
  4. Asserts `auditEvents` contains the expected event type
  5. For UNDERCUT/CEILING_RAISE: asserts `newPriceCents` is set and mathematically correct (competitor_lowest - 1 for undercut, within ceiling for ceiling_raise)
  6. For HOLD/SKIP: asserts `newPriceCents` is null
- All 17 fixtures pass
```

**NEW:**
```
### AC1 — `tests/integration/full-cycle.test.js` — 17-fixture parametric cycle test

**Given** `tests/integration/full-cycle.test.js` exists
**When** I run `node --test tests/integration/full-cycle.test.js`
**Then**:
- For each of the 17 P11 fixtures (load from `tests/fixtures/p11/`), the test:
  1. Loads the fixture via `loadFixture(name)` which returns `{ offers, expected, fixtureMeta }` — ALL three keys must be destructured and used
  2. Builds `skuChannel` mock using overrides from `fixture._fixture_meta.skuChannel_overrides` ONLY — no hand-coded per-fixture overrides that contradict the fixture's `_expected` outcome
  3. Instantiates a mock tx tracking `pri01_staging` INSERTs and audit_log writes
  4. Calls `decideForSkuChannel` directly from `worker/src/engine/decide.js` (real STEP 5 must be reachable — `cooperative-absorb.js` is on this branch, NOT stubbed; real STEP 4 circuit-breaker check must execute against real `circuit-breaker.js`)
  5. Asserts `result.action === fixture._expected.action` — the fixture's `_expected` field is the SOLE oracle. Hand-coded `expectedAction` lookup tables are FORBIDDEN.
  6. Asserts `result.newPriceCents === fixture._expected.newPriceCents ?? null`
  7. Asserts `result.auditEvents` contains `fixture._expected.auditEvent` when defined
- All 17 fixtures pass

**Negative assertion:** Grep the test file — zero occurrences of inline `const FIXTURE_CASES = [...]` style tables that override `_expected`. The fixture JSON files are authoritative.
```

**Rationale:** Closes Finding 4 (decorative `_expected`) and Finding 2 (rationalized wrong expectations). Fixture `_expected` becomes the oracle; per-fixture skuChannel overrides come from `_fixture_meta` (which exists per the existing fixture shape in the spec) rather than being inlined in the test.

**Coordinated fixture updates required:** The 5 NEW fixtures (and any of the existing 12 that lack a complete `_expected` + `_fixture_meta`) need their `_expected` and `_fixture_meta.skuChannel_overrides` fields populated so the test can be purely fixture-driven. Bob extends Amendment 4 to require the dev to audit each of the 17 fixtures and add missing metadata before running the gate.

---

### Amendment 5 — Tighten AC2 (lines 403-410)

**Section:** Acceptance Criteria > AC2

**OLD:**
```
### AC2 — Full flush assertion for write-action fixtures

**Given** fixtures producing UNDERCUT or CEILING_RAISE action
**When** `assembleCycle` is called with those fixtures
**Then**:
- A `pri01_staging` INSERT is recorded by the mock tx (with correct `new_price_cents`)
- Simulating PRI02 COMPLETE: the mock tx records an UPDATE clearing `pending_import_id`
- `circuitBreakerCheck` mock returns `{ tripped: false }` (no interference)
```

**NEW:**
```
### AC2 — Full flush assertion for write-action fixtures

**Given** fixtures producing UNDERCUT or CEILING_RAISE action
**When** `assembleCycle` is called with those fixtures (REAL `assembleCycle` from `worker/src/cycle-assembly.js`, not a re-implementation)
**Then**:
- The mock tx captures at least one `INSERT INTO pri01_staging` query with `new_price_cents` matching `result.newPriceCents` and `sku_channel_id` matching the test's skuChannel.id
- A real call to `markStagingPending(tx, importUuid, cycleId)` from `shared/mirakl/pri01-writer.js` is invoked — the mock tx captures the resulting `UPDATE sku_channels SET pending_import_id = ...` query
- A real call to `clearPendingImport(tx, importUuid, 'COMPLETE')` from `shared/mirakl/pri02-poller.js` (or wherever the COMPLETE-clearing logic lives) is invoked — the mock tx captures the resulting `UPDATE sku_channels SET pending_import_id = NULL` query
- The test asserts the captured query count and parameter shapes — not the engine's return shape

**Negative assertion:** No `stagingInserts.push(...)` followed by zero subsequent `assert.equal(stagingInserts.length, ...)` patterns. Captured queries MUST be asserted on; declaring a capture array without asserting its contents is FORBIDDEN.

**Negative assertion:** No test simulates PRI02 COMPLETE by calling `tx.query(...)` directly. The simulation MUST go through the real poller-side `clearPendingImport` function.
```

**Rationale:** Closes Finding 1 (dead assertion variables) and the tautological PRI02-COMPLETE simulation. Mandates real production-module invocations and captured-query assertions.

---

### Amendment 6 — Tighten AC3 (lines 412-421)

**Section:** Acceptance Criteria > AC3

**OLD:**
```
### AC3 — `tests/integration/pending-import-id-invariant.test.js` — Bundle C atomicity

**Given** `tests/integration/pending-import-id-invariant.test.js` exists
**When** I run `node --test tests/integration/pending-import-id-invariant.test.js`
**Then** the 5 sub-tests all pass:
1. `markStagingPending` sets `pending_import_id` on ALL staging rows in ONE UPDATE (not per-row)
2. Engine STEP 1 `decideForSkuChannel` returns SKIP when `skuChannel.pending_import_id IS NOT NULL`
3. Cooperative-absorption `absorbExternalChange` returns `{ skipped: true }` when `pending_import_id IS NOT NULL` (if module present; else assert via fixture `p11-pri01-pending-skip.json` behavior)
4. PRI02 COMPLETE handler clears `pending_import_id = null` for all rows with matching import_uuid (single UPDATE, not per-row)
5. PRI02 FAILED handler clears `pending_import_id` AND invokes PRI03 parser (or records the invocation)
```

**NEW:**
```
### AC3 — `tests/integration/pending-import-id-invariant.test.js` — Bundle C atomicity

**Given** `tests/integration/pending-import-id-invariant.test.js` exists
**When** I run `node --test tests/integration/pending-import-id-invariant.test.js`
**Then** the 5 sub-tests all pass — every sub-test imports REAL production modules:
1. Real `markStagingPending` from `shared/mirakl/pri01-writer.js` is called; mock tx captures exactly ONE UPDATE query (not N per-row UPDATEs) setting `pending_import_id = $1` with the import UUID
2. Real `decideForSkuChannel` from `worker/src/engine/decide.js` is called with `skuChannel.pending_import_id = 'uuid'`; returns `{ action: 'SKIP', reason: <STEP 1 precondition fail> }`
3. Real `absorbExternalChange` from `worker/src/engine/cooperative-absorb.js` is called with `skuChannel.pending_import_id = 'uuid'`; returns `{ absorbed: false, frozen: false, skipped: true }`. (Module is present on `bundle-c-integrated`; the "if module present; else fixture-fallback" clause from the old spec is REMOVED.)
4. Real `clearPendingImport(tx, importUuid, 'COMPLETE')` from `shared/mirakl/pri02-poller.js` is called; mock tx captures exactly ONE UPDATE clearing `pending_import_id = NULL` for matching `import_uuid`
5. Real `clearPendingImport(tx, importUuid, 'FAILED')` from `shared/mirakl/pri02-poller.js` is called; mock tx captures both the `pending_import_id = NULL` clear AND a recorded invocation of the PRI03 parser (e.g., spy on the parser export or assert on captured side-effect)

**Negative assertion:** No `transitionCronStateFn` injection pattern. Real `transitionCronState` from `shared/state/cron-state.js` is imported and called.

**Negative assertion:** Zero occurrences of `// stub for missing module` style comments. All Bundle C modules are present and used.
```

**Rationale:** Closes Finding 3 (unit-test-shaped integration tests). All production modules are real imports. Removes the conditional "if module present; else fixture-fallback" clause that authorized the workaround.

---

### Amendment 7 — Delete stub-fallback authorization (line 67 + Dev Notes section)

**Section:** Pre-implementation guidance + Dev Notes > "Modules Possibly Missing on This Branch"

**OLD (line 67 + lines 668-680 of the existing spec):**
```
**Before implementing tests:** Run `ls worker/src/engine/` and `ls worker/src/safety/` to verify which modules are present. For missing modules (cooperative-absorb, tier-classify, anomaly-freeze, reconciliation), the integration tests MUST inject mock implementations or use the stub-fallback approach documented in `worker/src/engine/decide.js` and `worker/src/cycle-assembly.js`.

[...]

### Modules Possibly Missing on This Branch

The worktree forks from story-7.6 which was stacked on story-7.2. The following modules may not be present:
- `worker/src/engine/cooperative-absorb.js` (Story 7.3, parallel worktree)
- `worker/src/engine/tier-classify.js` (Story 7.5, parallel worktree)
- `worker/src/safety/anomaly-freeze.js` (Story 7.4, parallel worktree)
- `worker/src/safety/reconciliation.js` (Story 7.7, parallel worktree)

**Decision rule:** Check each with `ls worker/src/engine/` and `ls worker/src/safety/`.
- If present: import and use real module
- If absent: inject mock behavior in the test (do NOT add stub modules)

For cooperative-absorb-specific tests where the module is absent, use the `p11-pri01-pending-skip.json` fixture to test the skip-on-pending path via `decideForSkuChannel` STEP 1 (which is guaranteed to be on this branch).
```

**NEW:**
```
**Before implementing tests:** Verify all 8 Bundle C modules are present on `bundle-c-integrated`. Run:
- `ls worker/src/engine/` → expect `decide.js`, `cooperative-absorb.js`
- `ls worker/src/safety/` → expect `circuit-breaker.js`
- `ls worker/src/` → expect `dispatcher.js`, `advisory-lock.js`, `cycle-assembly.js`
- `ls shared/mirakl/` → expect `pri01-writer.js`, `pri02-poller.js`, `pri03-parser.js`

If any Bundle C module is absent: this is a DISPATCH ERROR. Halt and escalate to Pedro/Bob. Do NOT proceed with test implementation.

Stories 7.4/7.5/7.7 (anomaly-freeze, tier-classify, reconciliation) are NOT Bundle C members. Their absence is expected and structural. The gate does NOT test those modules' behaviors — those modules' tests live in their own stories.

[Removed section: "Modules Possibly Missing on This Branch"]
```

**Rationale:** This is the load-bearing change. The original line 67 + Dev Notes section authorized the stub-fallback approach that produced the broken implementation. Removing it categorically — and adding the escalation rule for genuinely missing Bundle C modules — closes the escape hatch.

---

### Amendment 8 — Fix `p11-cooperative-absorption-anomaly-freeze` expected outcome

**Section:** Per-fixture Expected Outcomes table (line 213) + 5 Missing P11 Fixture Specs > `p11-cooperative-absorption-anomaly-freeze.json` (lines 366-383)

**OLD (line 213 table row):**
```
| `p11-cooperative-absorption-anomaly-freeze` | SKIP (frozen after absorption) | `anomaly-freeze` (atencao) |
```
(This row already says SKIP — but the test implementation at full-cycle.test.js:266-279 expected HOLD with rationalization comment. The amendment ensures the table value is enforced.)

**OLD (fixture spec block, lines 366-383):**
```
### `p11-cooperative-absorption-anomaly-freeze.json`

Scenario: `current_price_cents` (1000) vs `last_set_price_cents` (2500). Deviation = |1000−2500|/2500 = 60% > 40% threshold. Freeze fires. Engine SKIPs this cycle. `anomaly-freeze` Atenção emitted. Critical alert sent.

```json
{
  "_note": "Cooperative absorption anomaly freeze: ...",
  "_expected": { "absorbed": false, "frozen": true, "auditEvent": "anomaly-freeze", "priority": "atencao" },
  "products": [...]
}
```

**NEW:**
```
### `p11-cooperative-absorption-anomaly-freeze.json`

Scenario: `current_price_cents` (1000) vs `last_set_price_cents` (2500). Deviation = |1000−2500|/2500 = 60% > 40% threshold. Real `absorbExternalChange` (`worker/src/engine/cooperative-absorb.js`, present on `bundle-c-integrated`) fires anomaly-freeze BEFORE the per-SKU circuit-breaker check. Engine returns SKIP. `anomaly-freeze` Atenção emitted. Critical alert sent.

```json
{
  "_note": "Cooperative absorption anomaly freeze: current_price=1000 vs last_set_price=2500 (deviation=60% > 40%). Freeze fires before CB check. anomaly-freeze Atenção emitted. Critical alert sent. Engine SKIPs. Fixture skuChannel: current_price_cents=1000, last_set_price_cents=2500, pending_import_id=null.",
  "_expected": {
    "action": "SKIP",
    "newPriceCents": null,
    "absorbed": false,
    "frozen": true,
    "auditEvent": "anomaly-freeze",
    "priority": "atencao"
  },
  "_fixture_meta": {
    "skuChannel_overrides": {
      "current_price_cents": 1000,
      "last_set_price_cents": 2500,
      "pending_import_id": null
    }
  },
  "products": [
    {
      "product_references": [{ "reference_type": "EAN", "reference": "0000000000017" }],
      "offers": [
        { "shop_name": "Competitor A",  "active": true, "total_price": 19.99, "shop_id": null },
        { "shop_name": "Competitor B",  "active": true, "total_price": 21.00, "shop_id": null },
        { "shop_name": "Easy - Store",  "active": true, "total_price": 10.00, "shop_id": null }
      ]
    }
  ]
}
```

**Negative assertion:** No "acceptable transient behavior for this branch" rationalization comments anywhere in the test files. If the fixture's `_expected.action` disagrees with the engine's real behavior, that's a failing test — not a comment.
```

**Rationale:** Closes Finding 2. With `cooperative-absorb.js` present on `bundle-c-integrated`, the real anomaly-freeze path is exercised. Expected action is `SKIP`. The fixture is also updated to include `action` + `newPriceCents` in `_expected` (per Amendment 4's oracle requirement) and `_fixture_meta.skuChannel_overrides` (per Amendment 4's hand-coded-override prohibition).

---

### Amendment 9 — Add AC8: gate-failure-on-missing-module safety net

**Section:** Acceptance Criteria (new AC after AC7)

**NEW:**
```
### AC8 — No-stub-fallback safety net

**Given** any of the 8 Bundle C production modules is absent from the worktree
**When** `node --test tests/integration/full-cycle.test.js` (or any of the 3 integration test files) loads
**Then** the test suite throws at import time — does NOT silently fall back to mocks.

**Implementation:** Each integration test file MUST top-level `await import` each Bundle C module it depends on. Module-not-found errors propagate to the test runner as failures. NO try/catch around imports. NO conditional `if (modulePresent) { ... } else { ... mock ... }` logic.

**Negative assertion grep:** Zero occurrences of `try { await import(...) } catch` in `tests/integration/`. Zero occurrences of `// stub for missing module` style comments. Zero occurrences of conditional-import patterns.

**Why this AC exists:** The original Story 7.8 spec authorized stub-fallback for missing modules, which produced an implementation that passed without exercising the bundle it was supposed to gate. This safety net ensures any future dispatch-topology error surfaces as a loud test failure, not a silent degradation of gate strength.
```

**Rationale:** Makes the bundle-c-integrated branch invariant a CI-enforced contract. If any future re-dispatch goes wrong and the worktree is missing a module, the failure is loud and immediate, not silent.

---

## Section 5 — Implementation Handoff

**Scope classification:** Moderate — single-story spec rewrite + branch-topology recovery (joint ops with Pedro) + Future-work watch item (bundle_dispatch_orders patch to BAD; deferred to Epic 7 retro).

**Handoff sequence:**

1. **This SCP doc** → Pedro reviews and approves (or sends back for revision).
2. **Joint destructive ops (Pedro + Bob, when approved):**
   - `gh pr close 90 -c "..."` with Pedro's drafted comment from the conversation thread.
   - `git worktree remove .worktrees/story-7.8-end-to-end-integration-gate-...`.
   - `git branch -D story-7.8-end-to-end-integration-gate-...` (reversible from reflog within 90 days).
3. **Joint synthetic-branch creation (Pedro + Bob):**
   - `git checkout story-7.6-worker-src-safety-circuit-breaker-js-per-sku-15-per-cycle-20`
   - `git checkout -b bundle-c-integrated`
   - `git merge --no-ff story-7.3-worker-src-engine-cooperative-absorb-js-step-2-absorption-skip-on-pending`
   - Verify all 8 Bundle C modules present via the `ls` checks in Amendment 7's NEW text.
   - If conflicts: HALT, escalate. Do NOT proceed with re-dispatch until clean.
4. **/bad re-dispatch (BAD coordinator, post-recovery):**
   - Phase 0 picks up amended Story 7.8 (via fresh `/bmad-create-story` reading this SCP, OR via direct application of this SCP's amendments to a re-emitted spec file).
   - Phase 1 forks worktree from `bundle-c-integrated`.
   - Phase 2-7 run normally. Step 7 review on the new PR.
5. **Bundle C merge cascade (Pedro + Bob, post-7.8-done):**
   - Merge PRs in dependency order: #81 → #82 → #83 → #84 → #85 → #87 → #88 → #89 → new-7.8-PR.
   - `git branch -D bundle-c-integrated` (synthetic branch obsolete once main contains all commits).
6. **Epic 7 retro logs `bundle_dispatch_orders` BAD-dispatcher amendment** (Q3+Q4 from Bob's ruling) — codified rule prevents recurrence.

**Sprint-status.yaml updates:**
- No `development_status` changes at this stage. 7.8 stays `review` (it has an active PR record; the PR will be replaced).
- Post-recovery: BAD's normal status flow runs.
- Post-Bundle-C-done: Epic 7 retro logs the `bundle_dispatch_orders:` top-level section addition.

**Success criteria:**
- Amended Story 7.8 spec produces an implementation where all 4 verified findings (F1-F4) are closed — assertions are real, fixture `_expected` is oracle, integration tests exercise production modules, anomaly-freeze test asserts SKIP.
- `bundle-c-integrated` exists with all 8 modules present; `npm test` runs clean on it.
- Bundle C merges to main as a coherent atomic unit; gate fires on real modules.
- No "MAY NOT be on this branch" or stub-fallback language survives in any Story 7.8 artifact.

---

## Approvals

- **Bob (SM):** Authored this SCP 2026-05-11 per ruling delivered same day.
- **Pedro:** Approval signature here when reviewed:

  Approved: __________  Revise: __________  Date: __________

---

## Out-of-Scope (deferred items)

- BAD dispatcher rule patch (`bundle_dispatch_orders:` enforcement in Phase 0) — deferred to Epic 7 retrospective per Bob's ruling. Logged here as a forward-watch item.
- Bundle A/B audit — completed in Bob's ruling §5; no action required (single-story bundle and schema-atomicity bundle, respectively; neither at structural risk).
- Future-bundle pre-declaration of `bundle_dispatch_orders` in sprint-planning — to be added to `bmad-sprint-planning` skill when Epic 11/12 stories shard (12.1, 11.5+10.3 candidates).
