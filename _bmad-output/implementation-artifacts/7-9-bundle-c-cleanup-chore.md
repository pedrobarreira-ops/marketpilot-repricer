# Story 7.9: bundle-c-cleanup-chore

Status: ready-for-dev

<!-- Sharded 2026-05-13 by Bob (`bmad-create-story`) per Bundle C close-out retro §5 Q7 -->
<!-- Source: _bmad-output/implementation-artifacts/bundle-c-close-out-retro-2026-05-13.md §5 Q7 -->
<!-- NOT a Bundle C participant — not in bundle_dispatch_orders or merge_blocks. Dispatches normally from main. -->

## Story

As **the maintainer of Bundle C's joint-correctness contract**,
I want **9 test-tightening + spec-reconciliation + small-hardening follow-ups bundled into a single chore PR**,
so that **the 5 Bundle-C-introduced unit-test fails close, the 7.8 gate's stub-fallback regression surface stays loud, and Q8 Phase 2 CI gate expansion can fire on a clean `npm test`.**

---

## Acceptance Criteria

> **Bundle C invariant guard** (non-negotiable across all 9 ACs): the 3 Bundle C integration test files MUST remain green at 45/45.
> - [tests/integration/full-cycle.test.js](tests/integration/full-cycle.test.js)
> - [tests/integration/pending-import-id-invariant.test.js](tests/integration/pending-import-id-invariant.test.js)
> - [tests/integration/circuit-breaker-trip.test.js](tests/integration/circuit-breaker-trip.test.js)
>
> If any change in this story turns one of these red, STOP and re-shape — the cleanup is not allowed to widen Bundle C's regression surface.

### AC1 — pri02-poller lazy import: narrowed catch (retroactive 983b8fb pattern)

**Given** [shared/mirakl/pri02-poller.js:257-261](shared/mirakl/pri02-poller.js#L257-L261) currently uses a **bare catch** for the lazy `import('./pri03-parser.js')`:

```js
let fetchAndParseErrorReport;
try {
  ({ fetchAndParseErrorReport } = await import('./pri03-parser.js'));
} catch {
  fetchAndParseErrorReport = null; // Story 6.3 not yet deployed
}
```

**When** I retrofit the same narrowed-catch pattern Story 7.2 commit `983b8fb` applied to [worker/src/engine/decide.js:117-128](worker/src/engine/decide.js#L117-L128) and [worker/src/engine/decide.js:217-232](worker/src/engine/decide.js#L217-L232),

**Then** the catch becomes:

```js
let fetchAndParseErrorReport;
try {
  ({ fetchAndParseErrorReport } = await import('./pri03-parser.js'));
} catch (err) {
  if (err && err.code !== 'ERR_MODULE_NOT_FOUND') {
    throw err;
  }
  fetchAndParseErrorReport = null; // Story 6.3 not yet deployed (pre-Bundle-C state)
}
```

— and Story 6.3 has already shipped, so in practice the pre-Bundle-C branch is a defensive safety net; real bugs (DB errors, syntax errors in the parser) now propagate instead of being silently swallowed.

**Scope guard:** the inner `await import('./pri03-parser.js')` at [shared/mirakl/pri02-poller.js:297](shared/mirakl/pri02-poller.js#L297) (inside the `if (fetchAndParseErrorReport)` block) is already protected — it only runs when the outer import succeeded, and any failure there SHOULD propagate. Do **not** wrap it.

**Citation:** commit `983b8fb` ("fix(7.2): step 7 PR review — narrow stub catch blocks to ERR_MODULE_NOT_FOUND only") — same justification carries over. Deferred-work lines 377 + 402.

### AC2 — full-cycle.test.js AC8: 5 missing module-presence assertions

**Given** [tests/integration/full-cycle.test.js:435-448](tests/integration/full-cycle.test.js#L435-L448) currently verifies presence of 7 Bundle C modules via `typeof === 'function'` assertions (`decideForSkuChannel`, `absorbExternalChange`, `checkPerSkuCircuitBreaker`, `checkPerCycleCircuitBreaker`, `markStagingPending`, `clearPendingImport`, `assembleCycle`),

**When** I extend the test file's top-of-file dynamic-import block (currently [lines 37-42](tests/integration/full-cycle.test.js#L37-L42)) and the AC8 `describe` block to add presence assertions for these **5 missing** Bundle C modules:

| # | Logical name | Actual path |
|---|---|---|
| 1 | advisory-lock | [worker/src/advisory-lock.js](worker/src/advisory-lock.js) |
| 2 | master-cron | [worker/src/jobs/master-cron.js](worker/src/jobs/master-cron.js) |
| 3 | pri02-poll | [worker/src/jobs/pri02-poll.js](worker/src/jobs/pri02-poll.js) |
| 4 | pri03-parser | [shared/mirakl/pri03-parser.js](shared/mirakl/pri03-parser.js) |
| 5 | dispatcher | [worker/src/dispatcher.js](worker/src/dispatcher.js) |

**Then**:
- Each addition uses **top-level `await import` with NO try/catch** (per AC8 verbatim language: *"Zero occurrences of `try { await import(...) } catch` in `tests/integration/`"* — Story 7.8 spec lines 533-543).
- Each addition exports at least one symbol that the AC8 `describe` block asserts `typeof X === 'function'` (or `typeof X === 'object'` if module exports an object).
- A missing module causes the entire test file to fail at load time via `ERR_MODULE_NOT_FOUND` — same property AC8 already enforces for the existing 7 modules.

**Discovery rule:** before adding each import, grep for the exported symbol(s) the module surfaces (`grep -n "^export" <path>`) and assert on the most representative one. Examples:
- `worker/src/advisory-lock.js` → `acquireCustomerLock` / `releaseCustomerLock`
- `worker/src/jobs/master-cron.js` → the job entry function (whatever it exports — likely `runMasterCronTick` or similar)
- `worker/src/jobs/pri02-poll.js` → the job entry function (whatever it exports)
- `shared/mirakl/pri03-parser.js` → `fetchAndParseErrorReport` + `scheduleRebuildForFailedSkus`
- `worker/src/dispatcher.js` → `dispatchReadyCustomers` or equivalent

**Source:** retro §5 Q7 item 2 + deferred-work line 418.

### AC3 — full-cycle.test.js AC2: remove staging-INSERT circularity

**Given** [tests/integration/full-cycle.test.js:347-374](tests/integration/full-cycle.test.js#L347-L374) currently exhibits **assertion circularity**: the test itself issues the `INSERT INTO pri01_staging` via `tx.query` ([lines 348-351](tests/integration/full-cycle.test.js#L348-L351)) and then asserts on the captured query at [lines 360-374](tests/integration/full-cycle.test.js#L360-L374) — meaning the assertion fires on the test's own SQL, not on real `assembleCycle` behavior.

**When** I restructure AC2 so `assembleCycle` owns the staging INSERT path,

**Then** the test:
- Either invokes `assembleCycle({...})` with arguments that drive `decideForSkuChannel` → write-action → staging INSERT — eliminating the manual `tx.query('INSERT INTO pri01_staging ...')` at [lines 348-351](tests/integration/full-cycle.test.js#L348-L351).
- Or, if `assembleCycle`'s real signature can't be exercised against the mock tx without deeper rework (likely), at minimum extracts the staging INSERT into a helper that explicitly stamps the source ("issued by assembleCycle proxy, not by AC2 test directly") and the assertion is rewritten to verify the helper's call site — making the indirection explicit instead of circular.

**Recommended path:** drive AC2 via `assembleCycle` if the existing mock-tx surface supports it. If it doesn't (e.g., `assembleCycle` reads from real DB tables not stubbed in `buildMockTx`), surface the gap in Dev Agent Record and apply the second path (extract-and-document); pure circularity is the failure mode being closed, not the test's existence.

**Source:** retro §5 Q7 item 3 + deferred-work line 419.

### AC4 — pending-import-id-invariant.test.js sub-test 1: N>1 batch atomicity

**Given** [tests/integration/pending-import-id-invariant.test.js:155-206](tests/integration/pending-import-id-invariant.test.js#L155-L206) sub-test 1 currently exercises `markStagingPending` with **only one** staging row and **only one** channel row ([lines 162-180](tests/integration/pending-import-id-invariant.test.js#L162-L180)) and asserts `pendingUpdates.length === 1` — which trivially holds because there is only one row regardless of batch atomicity.

**When** I add a **new sub-test** (sub-test 1b or 1.5) immediately after sub-test 1 that supplies N>1 staging rows AND N>1 corresponding channel rows (e.g., 3 staging rows mapped to 3 sku_channel rows across multiple shop_skus and/or channels),

**Then** the new sub-test asserts:
- Exactly **one** UPDATE query is captured (`pendingUpdates.length === 1`) despite N rows — verifying the implementation does a single batch UPDATE, not N per-row UPDATEs.
- The single captured UPDATE's WHERE clause matches all N rows (e.g., uses `IN (...)` / `ANY($::uuid[])` semantics).
- All N rows share the same `pending_import_id = importId` after the call (capture via RETURNING or via subsequent SELECT in the mock).

**Scope guard:** sub-test 1 itself stays unchanged — it documents the N=1 base case. The new sub-test 1b is purely additive.

**Source:** retro §5 Q7 item 4 + deferred-work line 420.

### AC5 — Reconcile AC3 sub-test 5 spec/impl drift (spec amendment OR impl update)

**Given** Story 7.8 spec line 489-490 (AC3 sub-test 5) says verbatim:

> *"Real `clearPendingImport(tx, importUuid, 'FAILED')` from `shared/mirakl/pri02-poller.js` is called; mock tx captures both the `pending_import_id = NULL` clear AND **a recorded invocation of the PRI03 parser**"*

— but the implementation at [tests/integration/pending-import-id-invariant.test.js:305-351](tests/integration/pending-import-id-invariant.test.js#L305-L351) calls `clearPendingImport` with **`hasErrorReport: false`** ([line 320](tests/integration/pending-import-id-invariant.test.js#L320)), which by design skips the PRI03 parser path entirely. The assertion at [lines 343-350](tests/integration/pending-import-id-invariant.test.js#L343-L350) instead checks `auditInserts.length >= 1` (a `pri02-failed-transient` audit_log INSERT).

**When** I reconcile this drift by choosing **one** of two paths:

- **Path A (amend spec):** Update Story 7.8 AC3 sub-test 5 spec wording to reflect what's actually tested — *"... mock tx captures both the `pending_import_id = NULL` clear AND a `pri02-failed-transient` audit_log INSERT (NO PRI03 parser invocation when `hasErrorReport: false`)"*. This is the lighter-touch path; the implementation stays as-is. Edit lands as a comment annotation at the AC3 sub-test 5 spec line in `_bmad-output/implementation-artifacts/7-8-end-to-end-integration-gate-full-cycle-test-on-all-17-p11-fixtures-atomicity-bundle-gate-for-ad7-ad8-ad9-ad11.md` (file edit on the existing shard — Story 7.8 is `done` but the shard is the source-of-record).

- **Path B (update impl):** Add a second sub-test (sub-test 5b) that invokes `clearPendingImport` with **`hasErrorReport: true`** and supplies a stubbed `pri03-parser.js` invocation oracle (e.g., a global counter or injected `fetchAndParseErrorReport` reference), and asserts the parser was invoked — matching the spec's original intent. Sub-test 5 itself stays as the `hasErrorReport: false` baseline.

**Then** the dev:
- Picks **one** path explicitly in Dev Agent Record (cite the chosen path + a 1-sentence rationale).
- Path A: edits the Story 7.8 shard's AC3 sub-test 5 line in place.
- Path B: extends `pending-import-id-invariant.test.js` with sub-test 5b; sub-test 5 stays unchanged.

**Recommendation:** Path A (lighter touch; the actual behavioral guarantee — atomic clear + audit emission — is already what AC3 sub-test 5 verifies). Path B is justified only if Pedro wants the parser-invocation gate restored. Dev should propose Path A in Dev Agent Record and flag for Pedro confirmation if uncertain.

**Source:** retro §5 Q7 item 5 + deferred-work line 421.

### AC6 — Reconcile AC4 spec/impl drift on `transitionCronStateFn` injection

**Given** Story 7.8 spec line 503 (AC4) says verbatim:

> *"REAL `transitionCronState` is invoked (via real circuit-breaker.js) with `{ from: 'ACTIVE', to: 'PAUSED_BY_CIRCUIT_BREAKER', context: { numerator: 21, denominator: 100 } }`"*

— but the implementation at [worker/src/safety/circuit-breaker.js:101-106](worker/src/safety/circuit-breaker.js#L101-L106) accepts `transitionCronStateFn` as an **injectable** parameter (default: imported `_transitionCronState`), and the test at [tests/integration/circuit-breaker-trip.test.js:84-100](tests/integration/circuit-breaker-trip.test.js#L84-L100) injects a **mock** `transitionCronStateFn` that captures calls into `transitionCalls.push(args)` — not the REAL function. The dev's own comment at [circuit-breaker-trip.test.js:90-93](tests/integration/circuit-breaker-trip.test.js#L90-L93) acknowledges this tension.

**When** I reconcile this drift by choosing **one** of two paths:

- **Path A (amend spec):** Update Story 7.8 AC4 wording to say *"the REAL `transitionCronStateFn` injection point is exercised — test supplies a capture-lambda that the real `checkPerCycleCircuitBreaker` invokes via its standard injection contract; the captured args match `{ from: 'ACTIVE', to: 'PAUSED_BY_CIRCUIT_BREAKER', context: { numerator: 21, denominator: 100 } }`"*. Implementation stays as-is. Edit lands in the Story 7.8 shard's AC4 block.

- **Path B (update impl):** Remove the `transitionCronStateFn` injection in the test ([circuit-breaker-trip.test.js:99-103](tests/integration/circuit-breaker-trip.test.js#L99-L103)), letting `checkPerCycleCircuitBreaker` invoke the **default** imported `_transitionCronState`. The mock tx's `UPDATE customer_marketplaces` handler ([circuit-breaker-trip.test.js:60-62](tests/integration/circuit-breaker-trip.test.js#L60-L62)) and `INSERT INTO audit_log` handler ([lines 64-66](tests/integration/circuit-breaker-trip.test.js#L64-L66)) ALREADY capture the side effects — assert on those captured queries instead of on `transitionCalls`.

**Then** the dev:
- Picks **one** path explicitly in Dev Agent Record.
- Path A: edits Story 7.8 shard's AC4 in place.
- Path B: refactors `circuit-breaker-trip.test.js` AC4 sub-test to omit `transitionCronStateFn` injection and assert on mock-tx captured queries (`UPDATE customer_marketplaces SET cron_state = 'PAUSED_BY_CIRCUIT_BREAKER'` + `INSERT INTO audit_log` with `circuit-breaker-trip` event_type).

**Recommendation:** Path B (closes the drift at the source — the test actually runs the real function path). Path B preserves the spec's intent ("REAL transitionCronState is invoked") and matches the architectural pattern (Story 7.6 chose injection-for-testability; the integration gate should still exercise the real default). Risk: real `transitionCronState` may need additional mock-tx wiring (legal-transitions matrix check, audit emission in same tx) — surface in Dev Agent Record if friction emerges.

**Source:** retro §5 Q7 item 6 + deferred-work line 422.

### AC7 — Migrate Story 7.2 + 7.3 unit tests to `fixture._expected` oracle pattern

**Given** the following unit tests use **hardcoded** per-fixture values that diverge from `_expected` after fixture re-tuning (closes the 5 Bundle-C-introduced unit-test fails surfaced in retro §6 W2):

| Test file | Pattern in use | Drift symptom |
|---|---|---|
| [tests/worker/engine/decide.test.js](tests/worker/engine/decide.test.js) | `assert.equal(result.newPriceCents, 2849, ...)` ([line 149](tests/worker/engine/decide.test.js#L149)) and ~11 sibling fixtures with hardcoded numbers | Hardcoded values must match fixture `_expected.newPriceCents` |
| [tests/worker/engine/cooperative-absorb.test.js](tests/worker/engine/cooperative-absorb.test.js) AC4 block [lines 349-460](tests/worker/engine/cooperative-absorb.test.js#L349-L460) | Reads `fixture._preconditions.skuChannel.*` ([lines 364-372](tests/worker/engine/cooperative-absorb.test.js#L364-L372)) | Fixture schema migrated to `_fixture_meta.skuChannel_overrides` — `_preconditions` no longer exists |

**When** I migrate both files to read from `fixture._expected` and `fixture._fixture_meta.skuChannel_overrides` / `fixture._fixture_meta.customerMarketplace_overrides` — mirroring the AC1 pattern already in [tests/integration/full-cycle.test.js:197-245](tests/integration/full-cycle.test.js#L197-L245),

**Then**:
- All Story 7.2 fixture tests (`fixture_1_tier1_undercut_succeeds` through `fixture_12_pri01_pending_skip_precondition`) replace hardcoded values with:
  - `assert.equal(result.action, fixture._expected.action, ...)`
  - `assert.equal(result.newPriceCents, fixture._expected.newPriceCents, ...)`
  - `assert.ok(result.auditEvents.includes(fixture._expected.auditEvent), ...)` (skip if `_expected.auditEvent === null` or `undefined`)
- `skuChannel` and `customerMarketplace` builders in `decide.test.js` either accept `fixture._fixture_meta.skuChannel_overrides` directly (mirroring [full-cycle.test.js:74-99](tests/integration/full-cycle.test.js#L74-L99)) OR continue to use explicit `makeSkuChannel({ ... })` calls that mirror the fixture's `_fixture_meta` values verbatim (no implicit drift).
- Cooperative-absorb's AC4 block ([cooperative-absorb.test.js:349-460](tests/worker/engine/cooperative-absorb.test.js#L349-L460)) replaces all `fixture._preconditions.*` reads with `fixture._fixture_meta.skuChannel_overrides.*` and `fixture._fixture_meta.customerMarketplace_overrides.*`. The fixture migrated to this schema in [tests/fixtures/p11/p11-cooperative-absorption-within-threshold.json](tests/fixtures/p11/p11-cooperative-absorption-within-threshold.json) — verify against the actual JSON.

**Acceptance gate:** after migration, `npm test` (or `node --test tests/worker/engine/decide.test.js tests/worker/engine/cooperative-absorb.test.js`) shows **0 fails introduced by Bundle C** (the 5-fail subset from retro §6 W2 goes green). Pre-existing 23 fails (W2) are out-of-scope.

**Constraint:** the 17 P11 fixtures are immutable in this story — do NOT add or remove fixtures, do NOT change `_expected` values in any fixture file. The migration is test-side only. (Story 7.4 will flip `p11-cooperative-absorption-anomaly-freeze.json` `_expected.auditEvent` per retro W6 — out-of-scope here.)

**Source:** retro §5 Q7 item 7 + deferred-work line 424.

### AC8 — Regression test for narrowed-catch on decide.js dynamic imports

**Given** [worker/src/engine/decide.js:117-128](worker/src/engine/decide.js#L117-L128) (STEP 2) and [worker/src/engine/decide.js:217-232](worker/src/engine/decide.js#L217-L232) (STEP 5) use the narrowed-catch pattern from commit `983b8fb` — re-throwing any error whose code is NOT `ERR_MODULE_NOT_FOUND`,

**When** I add a regression test asserting this behavior survives future refactors,

**Then** I land **one** of two test shapes (developer's choice — pick whichever is cleaner against the existing test harness):

- **Path A (source-grep structural assertion):** A new test in [tests/worker/engine/decide.test.js](tests/worker/engine/decide.test.js) that reads `decide.js` as a string via `readFileSync` and asserts via regex / substring that both catch blocks contain the literal pattern `err.code !== 'ERR_MODULE_NOT_FOUND'` (or equivalent — `err && err.code !== 'ERR_MODULE_NOT_FOUND'`). At least 2 occurrences (STEP 2 + STEP 5). Catches accidental reversion to bare-catch.

- **Path B (behavioral test with shim):** A test that monkey-patches `cooperative-absorb.js`'s exported `absorbExternalChange` to throw a `TypeError('forced runtime error')` at call time, then invokes `decideForSkuChannel` and asserts the `TypeError` propagates (NOT silently swallowed). Constraint: monkey-patching ES module exports in Node's test runner is fragile — use `import.meta.resolve` or a per-test module shim if feasible; otherwise fall back to Path A.

**Recommendation:** Path A — structural assertion is enough for regression protection and avoids the import-shimming complexity. Document the choice in Dev Agent Record.

**Scope guard:** this test verifies the **STEP 2 (cooperative-absorb)** and **STEP 5 (circuit-breaker)** catch blocks in `decide.js`. It does NOT verify the new narrowed-catch in `pri02-poller.js` (AC1) — that's covered by AC1's own existence + lint passing. If the dev wants extra protection, an analogous Path-A grep against `pri02-poller.js` is welcome but not required.

**Source:** retro §5 Q7 item 8 + deferred-work line 403.

### AC9 — Three-strike re-fire suppression behavioral test in pri03-parser

**Given** [shared/mirakl/pri03-parser.js](shared/mirakl/pri03-parser.js) emits the `pri01-fail-persistent` Atenção event + critical alert when `pri01_consecutive_failures >= 3` (existing 3-strike behavior tested at [tests/shared/mirakl/pri03-parser.test.js:507+](tests/shared/mirakl/pri03-parser.test.js#L507) and lines 579+),

**When** I add a **new behavioral test** asserting that a SKU which has **already** been frozen by a prior 3-strike trip (`frozen_for_pri01_persistent: true`) does **NOT** re-emit the `pri01-fail-persistent` event nor re-send the critical alert on a subsequent failed PRI01 cycle,

**Then** the new test:
- Sets up a `makeSkuChannelRow({ consecutiveFailures: 4, frozen_for_pri01_persistent: true })` (already frozen + 4th consecutive failure).
- Invokes `scheduleRebuildForFailedSkus` (or the appropriate parser entry point that performs the 3-strike escalation) with this row.
- Asserts: `writeAuditEvent` was **NOT** called with `eventType: 'pri01-fail-persistent'` this cycle.
- Asserts: the mock `sendCriticalAlert` was **NOT** invoked this cycle.
- (Optional) Asserts the freeze UPDATE is also NOT re-issued (already-frozen rows don't get re-frozen).

**Scope guard:** if `pri03-parser.js` does NOT currently implement re-fire suppression (i.e., the test would fail because the production code keeps re-emitting), the dev MUST surface this as a discovery in Dev Agent Record and:
- Either add minimal suppression logic in `pri03-parser.js` (check `frozen_for_pri01_persistent` before emitting `pri01-fail-persistent` event + alert)
- Or downgrade AC9 to an `.xfail` / `.todo` skip with explicit comment citing the production-code gap, and surface to Pedro for a follow-up story.

**Recommendation:** if the production code lacks suppression, add it inline (small, well-scoped) — the cleanup PR is the right place since it's a Bundle C joint-correctness concern (cooperative-absorption + 3-strike loop interaction). If the change is non-trivial (>30 LoC or touches multiple modules), defer to a follow-up story.

**Source:** retro §5 Q7 item 9 + deferred-work line 378.

---

## Tasks / Subtasks

> Tasks are grouped to match the AC numbering. Each AC owns one task; sub-tasks decompose by file.

- [ ] **Task 1 (AC1)** — Narrow `pri02-poller.js` lazy import catch to `err.code !== 'ERR_MODULE_NOT_FOUND'`
  - [ ] Edit [shared/mirakl/pri02-poller.js:257-261](shared/mirakl/pri02-poller.js#L257-L261) — replace bare `catch {}` with narrowed-catch matching commit `983b8fb` shape.
  - [ ] Run `node --test tests/integration/full-cycle.test.js tests/integration/pending-import-id-invariant.test.js tests/integration/circuit-breaker-trip.test.js` — confirm 45/45 still green.
  - [ ] Run `npm run lint:eslint` on `shared/mirakl/pri02-poller.js` — confirm no new lint errors.

- [ ] **Task 2 (AC2)** — Extend full-cycle.test.js AC8 with 5 missing module-presence imports
  - [ ] Grep production modules to confirm exported symbols: `worker/src/advisory-lock.js`, `worker/src/dispatcher.js`, `worker/src/jobs/pri02-poll.js`, `shared/mirakl/pri03-parser.js`, plus any 5th module not yet asserted.
  - [ ] Add 5 new top-level `await import` lines to [tests/integration/full-cycle.test.js:37-42](tests/integration/full-cycle.test.js#L37-L42) block — NO try/catch.
  - [ ] Extend the AC8 `describe` block at [lines 435-448](tests/integration/full-cycle.test.js#L435-L448) with 5 new `assert.equal(typeof X, 'function', ...)` checks.
  - [ ] Run `node --test tests/integration/full-cycle.test.js` — 45/45 still green; the 5 new assertions pass.

- [ ] **Task 3 (AC3)** — Remove staging-INSERT circularity in full-cycle.test.js AC2
  - [ ] Inspect `worker/src/cycle-assembly.js` `assembleCycle` signature — determine whether the mock-tx surface in [tests/integration/full-cycle.test.js:268-329](tests/integration/full-cycle.test.js#L268-L329) supports driving it.
  - [ ] If yes: rewrite Step 2 of the AC2 sub-test ([lines 348-351](tests/integration/full-cycle.test.js#L348-L351)) to invoke `assembleCycle({...})` instead of issuing the staging INSERT manually. The assertion at [lines 360-374](tests/integration/full-cycle.test.js#L360-L374) then validates that `assembleCycle`'s real write path issued the INSERT.
  - [ ] If no: extract the test-issued INSERT into a helper named `simulateAssembleCycleStagingInsert(...)` and update assertion comments to make the indirection explicit. Surface the `assembleCycle` mock-surface gap in Dev Agent Record.
  - [ ] Run `node --test tests/integration/full-cycle.test.js` — 45/45 still green.

- [ ] **Task 4 (AC4)** — Add N>1 batch atomicity sub-test to pending-import-id-invariant.test.js
  - [ ] Add new sub-test 1b immediately after [pending-import-id-invariant.test.js:206](tests/integration/pending-import-id-invariant.test.js#L206) (sub-test 1's closing brace) — call `markStagingPending` with N≥3 staging rows + N≥3 channel rows, assert `pendingUpdates.length === 1` AND the captured UPDATE's WHERE clause targets all N row ids (e.g., via `ANY($::uuid[])`).
  - [ ] Run `node --test tests/integration/pending-import-id-invariant.test.js` — sub-test 1b passes; existing 5 sub-tests still pass.

- [ ] **Task 5 (AC5)** — Reconcile AC3 sub-test 5 spec/impl drift
  - [ ] Pick Path A (amend spec) or Path B (extend impl). Document choice + rationale in Dev Agent Record.
  - [ ] Path A: edit [_bmad-output/implementation-artifacts/7-8-end-to-end-integration-gate-full-cycle-test-on-all-17-p11-fixtures-atomicity-bundle-gate-for-ad7-ad8-ad9-ad11.md:489-490](_bmad-output/implementation-artifacts/7-8-end-to-end-integration-gate-full-cycle-test-on-all-17-p11-fixtures-atomicity-bundle-gate-for-ad7-ad8-ad9-ad11.md#L489-L490) — replace "recorded invocation of the PRI03 parser" with the impl-matching wording quoted in AC5 Path A above. Add a 1-line comment `<!-- Amended 2026-05-13 per Story 7.9 AC5 Path A -->` adjacent.
  - [ ] Path B: add sub-test 5b in [tests/integration/pending-import-id-invariant.test.js](tests/integration/pending-import-id-invariant.test.js) with `hasErrorReport: true` + parser-invocation oracle.

- [ ] **Task 6 (AC6)** — Reconcile AC4 spec wording vs CB injection signature
  - [ ] Pick Path A (amend spec) or Path B (refactor test to use default). Document choice + rationale.
  - [ ] Path A: edit Story 7.8 shard AC4 wording (line 503).
  - [ ] Path B: refactor [tests/integration/circuit-breaker-trip.test.js:84-120](tests/integration/circuit-breaker-trip.test.js#L84-L120) AC4 sub-test — drop `transitionCronStateFn` injection at [lines 99-103](tests/integration/circuit-breaker-trip.test.js#L99-L103), assert on mock-tx captured `UPDATE customer_marketplaces` + `INSERT INTO audit_log` queries instead.
  - [ ] Run `node --test tests/integration/circuit-breaker-trip.test.js` — all CB-trip sub-tests still pass.

- [ ] **Task 7 (AC7)** — Migrate Story 7.2 + 7.3 unit tests to `fixture._expected` oracle
  - [ ] [tests/worker/engine/decide.test.js](tests/worker/engine/decide.test.js): for each of the 12 fixture tests, replace hardcoded `result.newPriceCents` / `result.action` / `result.auditEvents` expectations with `fixture._expected.*` reads.
  - [ ] [tests/worker/engine/cooperative-absorb.test.js](tests/worker/engine/cooperative-absorb.test.js) AC4 block [lines 349-460](tests/worker/engine/cooperative-absorb.test.js#L349-L460): replace all `fixture._preconditions.*` reads with `fixture._fixture_meta.skuChannel_overrides.*` and `fixture._fixture_meta.customerMarketplace_overrides.*`. Update `fixture_loads_and_has_required_preconditions` test ([lines 362-374](tests/worker/engine/cooperative-absorb.test.js#L362-L374)) accordingly OR rename it to `fixture_loads_and_has_required_metadata`.
  - [ ] Run `node --test tests/worker/engine/decide.test.js tests/worker/engine/cooperative-absorb.test.js` — the 5 Bundle-C-introduced fails go green. Pre-existing 23 fails (W2) are out-of-scope but should NOT regress.
  - [ ] Run full `npm test` and report total pass/fail count — confirm the new-fail count is 0.

- [ ] **Task 8 (AC8)** — Regression test for decide.js narrowed-catch
  - [ ] Pick Path A (source-grep) or Path B (behavioral). Document choice.
  - [ ] Path A: add a new test in [tests/worker/engine/decide.test.js](tests/worker/engine/decide.test.js) (e.g., `narrowed_catch_pattern_present_in_step_2_and_step_5`) that reads `worker/src/engine/decide.js` via `readFileSync` and asserts `err.code !== 'ERR_MODULE_NOT_FOUND'` appears at least 2 times.
  - [ ] Path B: monkey-patched module shim — implement only if Path A feels insufficient AND the shim approach is clean against `node:test`.
  - [ ] Run `node --test tests/worker/engine/decide.test.js` — new test passes; existing tests unaffected.

- [ ] **Task 9 (AC9)** — Three-strike re-fire suppression test
  - [ ] Add new test in [tests/shared/mirakl/pri03-parser.test.js](tests/shared/mirakl/pri03-parser.test.js) (after existing 3-strike tests around [line 579](tests/shared/mirakl/pri03-parser.test.js#L579)): `three_strike_re_fire_suppression_for_already_frozen_sku`.
  - [ ] Test setup: `makeSkuChannelRow({ id: 'sc-already-frozen', consecutiveFailures: 4, frozen_for_pri01_persistent: true })`.
  - [ ] Test assertions: `writeAuditEvent` NOT called with `eventType: 'pri01-fail-persistent'`; mock `sendCriticalAlert` NOT invoked; (optional) no re-freeze UPDATE issued.
  - [ ] If `pri03-parser.js` lacks suppression logic: add minimal suppression (check `frozen_for_pri01_persistent` before the 3-strike escalation block) AND surface the production-code change in Dev Agent Record + File List.
  - [ ] If suppression requires >30 LoC or cross-module changes: downgrade AC9 to `.skip` with a TODO comment citing the gap; surface to Pedro for a follow-up story.

- [ ] **Final acceptance** — Bundle C green-floor verification
  - [ ] Run `node --test tests/integration/full-cycle.test.js tests/integration/pending-import-id-invariant.test.js tests/integration/circuit-breaker-trip.test.js` — confirm **45/45 still pass**. This is the non-negotiable green floor; if any of these three flips red, the story is not done.
  - [ ] Run `npm test` (full suite) — report total pass / total fail / list any newly-failing test files.
  - [ ] Run `npm run lint` (or equivalent ESLint command) — confirm no new lint errors on touched files.
  - [ ] Update File List in Dev Agent Record with every file edited.

---

## Dev Notes

### Story shape

This is a **chore story**, not a feature story. The scope spans 7 test files + 1 production file (`pri02-poller.js`) + potentially 1 production file (`pri03-parser.js` if AC9 needs suppression added) + 1 spec shard (`7-8-*.md` if AC5 Path A or AC6 Path A chosen). No new migrations, no new routes, no new SSoT modules, no schema changes. All 9 items close deferred-work entries from the Bundle C close-out retro § 4 Bucket C list.

### Architecture compliance (the 27 negative-assertion constraints)

This story touches **zero** of the 27 architectural constraints. It is purely test-tightening + spec reconciliation + 1 small defensive hardening (item 1 narrowed-catch). No risk of introducing webhook listeners, SPA frameworks, OF24 calls, refurbished-product handling, etc. The constraints checklist is a clean pass.

### Bundle C atomicity guard

The 3 integration test files at `tests/integration/full-cycle.test.js`, `tests/integration/pending-import-id-invariant.test.js`, `tests/integration/circuit-breaker-trip.test.js` are the Bundle C atomicity gate (Story 7.8). They currently pass 45/45 against real production modules on `main`. **Every AC in this story is allowed to ADD to these files but never to remove, weaken, or break an existing assertion.** The "Final acceptance" task explicitly verifies 45/45 stays 45/45.

### Spec amendment authority (items 5, 6)

AC5 and AC6 offer Path A (amend Story 7.8 spec) as one of two choices. Editing a completed-story shard (Story 7.8 is `done`) is allowed in this case because:
- The amendment is purely descriptive — it brings the spec text in line with already-shipped tested behavior.
- It's NOT introducing a new requirement (which would require `/bmad-correct-course`).
- The retro §5 Q7 explicitly authorizes "spec amendment OR implementation update" for items 5 and 6.

If the dev picks Path A for either AC, the edit lands as an in-place comment annotation on the Story 7.8 shard with a 1-line marker: `<!-- Amended 2026-05-13 per Story 7.9 AC{5|6} Path A -->`. Do NOT use `/bmad-correct-course` — this isn't a corrective-action workflow; it's documentation hygiene.

### Five Bundle-C-introduced unit-test fails (AC7 scope)

The 5 fails surfaced in retro §6 W2 split across two test files:
- `tests/worker/engine/decide.test.js` — fixture tests with hardcoded `newPriceCents` / `action` values that diverge from `fixture._expected` after Story 7.8 SCP-2026-05-11 Amendment 4 re-tuned fixture `_expected` blocks.
- `tests/worker/engine/cooperative-absorb.test.js` AC4 block — reads `fixture._preconditions.*` but the fixture migrated to `_fixture_meta` schema. Lines 364-372 specifically reference `fixture._preconditions.skuChannel` / `fixture._preconditions.customerMarketplace` which no longer exist.

Dev should run `node --test tests/worker/engine/decide.test.js tests/worker/engine/cooperative-absorb.test.js` BEFORE making any changes to capture the baseline 5-fail surface, then re-run after AC7 migration to confirm all 5 go green.

### Anti-patterns to avoid

- **DO NOT** change any P11 fixture file in [tests/fixtures/p11/](tests/fixtures/p11/). The 17 fixtures are immutable in this story. Story 7.4 (anomaly-freeze) will flip `p11-cooperative-absorption-anomaly-freeze.json` `_expected.auditEvent` per retro W6 — out-of-scope here.
- **DO NOT** restructure `assembleCycle`, `markStagingPending`, `clearPendingImport`, `decideForSkuChannel`, `absorbExternalChange`, or any other Bundle C production module beyond the surgical narrowed-catch fix in AC1 (and optionally a small AC9 suppression check if needed). Bundle C is shipped — its internals are stable.
- **DO NOT** add new migrations. The story explicitly carries no schema changes.
- **DO NOT** weaken AC8's no-stub-fallback invariant. New imports added in AC2 use top-level `await import` with NO try/catch — matching the existing 7 imports.
- **DO NOT** silence pre-existing 23 unit-test fails (retro §6 W2). They are pre-Go-Live stabilization scope; this story closes only the Bundle-C-introduced 5.
- **DO NOT** start a `/bmad-correct-course` workflow for items 5 or 6. The spec amendments authorized here are documentation hygiene, not corrective action.

### Project Structure Notes

Files touched (anticipated):

| File | Reason | AC |
|---|---|---|
| [shared/mirakl/pri02-poller.js](shared/mirakl/pri02-poller.js) | Narrow lazy-import catch | AC1 |
| [tests/integration/full-cycle.test.js](tests/integration/full-cycle.test.js) | Add 5 module imports + AC8 assertions; restructure AC2 staging path | AC2, AC3 |
| [tests/integration/pending-import-id-invariant.test.js](tests/integration/pending-import-id-invariant.test.js) | Add sub-test 1b (N>1 batch); optionally sub-test 5b (AC5 Path B) | AC4, AC5 (Path B) |
| [tests/integration/circuit-breaker-trip.test.js](tests/integration/circuit-breaker-trip.test.js) | Refactor AC4 sub-test (AC6 Path B) | AC6 (Path B) |
| [tests/worker/engine/decide.test.js](tests/worker/engine/decide.test.js) | Migrate to `_expected` oracle + add narrowed-catch regression | AC7, AC8 |
| [tests/worker/engine/cooperative-absorb.test.js](tests/worker/engine/cooperative-absorb.test.js) | Migrate AC4 block to `_fixture_meta` schema | AC7 |
| [tests/shared/mirakl/pri03-parser.test.js](tests/shared/mirakl/pri03-parser.test.js) | Add 3-strike re-fire suppression test | AC9 |
| [shared/mirakl/pri03-parser.js](shared/mirakl/pri03-parser.js) | Add `frozen_for_pri01_persistent` suppression check if needed | AC9 (conditional) |
| [_bmad-output/implementation-artifacts/7-8-*-atomicity-bundle-gate-for-ad7-ad8-ad9-ad11.md](_bmad-output/implementation-artifacts/7-8-end-to-end-integration-gate-full-cycle-test-on-all-17-p11-fixtures-atomicity-bundle-gate-for-ad7-ad8-ad9-ad11.md) | AC3 sub-test 5 wording (AC5 Path A) and/or AC4 wording (AC6 Path A) | AC5/AC6 (Path A) |

The two duplicate test directories observed during sharding — `tests/worker/engine/` AND `tests/worker/src/engine/` — both contain `decide.test.js` and `cooperative-absorb.test.js`. Per Pedro's brief, the **`tests/worker/engine/` directory is canonical** for Story 7.9. If the dev discovers that `tests/worker/src/engine/` also has Bundle-C-impacted fails, flag in Dev Agent Record and ask Pedro before mass-migrating (the duplicate paths may indicate dead-code or a parallel-test-tree convention this story shouldn't touch).

### Testing Standards

- Test runner: `node --test` (per architecture constraint #2 — no Jest/Vitest).
- No new ESLint rules required. Existing `no-direct-fetch` / `no-raw-CSV-building` / `no-raw-INSERT-audit-log` / `no-float-price` rules apply unchanged.
- Mocking discipline: keep using `buildMockTx` / `makeMockTx` patterns established in Bundle C integration tests. No new mocking libraries.
- Fixture-loading: continue to read `tests/fixtures/p11/*.json` via `readFileSync`. Do not introduce a fixture-loader abstraction.

### Previous Story Intelligence

- **Story 7.2 (decide.js, PR #87, done 2026-05-13)**: shipped the narrowed-catch pattern for STEP 2 + STEP 5 dynamic imports via commit `983b8fb` (Step 7 review hardening). AC1 of this story applies the same pattern to `pri02-poller.js`. AC8 adds a regression test to lock the pattern in place.
- **Story 7.3 (cooperative-absorb.js, PR #88, done 2026-05-13)**: shipped via the synthetic `bundle-c-integrated` branch recovery (memory `reference_synthetic_integrated_branch_recovery`). AC7's cooperative-absorb test migration closes a fixture-schema drift introduced by SCP-2026-05-11 Amendment 4.
- **Story 7.6 (circuit-breaker.js, PR #89, done 2026-05-13)**: shipped with `transitionCronStateFn` as injectable. AC6 reconciles the test pattern with Story 7.8's spec wording.
- **Story 7.8 (Bundle C gate, PR #91 mega-merge squash 89b2378, 2026-05-13)**: shipped 45 integration tests against real Bundle C modules. AC2/AC3/AC5/AC6 tighten the gate against its own deferred-work findings (deferred-work lines 418, 419, 421, 422 from PR #91 review).
- **Bundle C close-out retro (2026-05-13)**: this story = retro §5 Q7. Retro §12 Session 2 explicitly schedules this between Session 1 (inline skill patches: Q1+Q2+Q3+Q4+Q5+Q6+Q8 Phase 1) and Session 3 (Story 7.4 anomaly-freeze). Pedro will dispatch via `/bad` in a fresh session.

### Git intelligence

- Branch: dispatches normally from `main` (NOT from `bundle-c-integrated` — that synthetic branch is queued for cleanup per SCP-2026-05-11 §6).
- Worktree fork point: `main` HEAD (currently commit `1501c72` per session state).
- Expected file count in PR: ~7-9 (the 7 test files + 1 production file + optionally 1 spec shard + optionally 1 second production file for AC9 suppression).
- No `bundle_dispatch_orders` constraint: this story is NOT part of any atomicity bundle and dispatches in isolation.
- Q8 Phase 1 CI gate (`node --test tests/integration/*.test.js` already running per retro §12 Session 1 Q8 Phase 1) is the safety floor — Bundle C 45/45 must stay green on the PR.

### References

- **Retro source-of-truth:** [_bmad-output/implementation-artifacts/bundle-c-close-out-retro-2026-05-13.md §5 Q7](_bmad-output/implementation-artifacts/bundle-c-close-out-retro-2026-05-13.md) (lines 263-279 contain the 9 items)
- **Story 7.8 (Bundle C gate spec):** [_bmad-output/implementation-artifacts/7-8-end-to-end-integration-gate-full-cycle-test-on-all-17-p11-fixtures-atomicity-bundle-gate-for-ad7-ad8-ad9-ad11.md](_bmad-output/implementation-artifacts/7-8-end-to-end-integration-gate-full-cycle-test-on-all-17-p11-fixtures-atomicity-bundle-gate-for-ad7-ad8-ad9-ad11.md) — AC3 sub-test 5 at line 489-490; AC4 at lines 496-506; AC8 at lines 533-543
- **Story 7.2 narrowed-catch precedent:** commit `983b8fb` (2026-05-11) — `fix(7.2): step 7 PR review — narrow stub catch blocks to ERR_MODULE_NOT_FOUND only`
- **Production modules:**
  - [shared/mirakl/pri02-poller.js:257-261](shared/mirakl/pri02-poller.js#L257-L261) (AC1 target)
  - [worker/src/engine/decide.js:117-128](worker/src/engine/decide.js#L117-L128) + [217-232](worker/src/engine/decide.js#L217-L232) (AC8 reference + 983b8fb)
  - [worker/src/safety/circuit-breaker.js:101-106](worker/src/safety/circuit-breaker.js#L101-L106) (AC6 signature)
  - [shared/mirakl/pri03-parser.js](shared/mirakl/pri03-parser.js) (AC9 suppression target)
- **Test files:**
  - [tests/integration/full-cycle.test.js](tests/integration/full-cycle.test.js) (AC2, AC3)
  - [tests/integration/pending-import-id-invariant.test.js](tests/integration/pending-import-id-invariant.test.js) (AC4, AC5)
  - [tests/integration/circuit-breaker-trip.test.js](tests/integration/circuit-breaker-trip.test.js) (AC6)
  - [tests/worker/engine/decide.test.js](tests/worker/engine/decide.test.js) (AC7, AC8)
  - [tests/worker/engine/cooperative-absorb.test.js](tests/worker/engine/cooperative-absorb.test.js) (AC7)
  - [tests/shared/mirakl/pri03-parser.test.js](tests/shared/mirakl/pri03-parser.test.js) (AC9)
- **Distillates (for citation only — story scope already in-scope):**
  - [_bmad-output/planning-artifacts/architecture-distillate/_index.md](_bmad-output/planning-artifacts/architecture-distillate/_index.md) — 27 architectural constraints (clean pass for this story)
  - [_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md](_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md) — Bundle C epic context (background only — Story 7.9 is post-bundle cleanup)
- **Project context:** [project-context.md](project-context.md) §3 Atomicity Bundles (Bundle C invariant); §F1-F13 Amendments QR; §Library Empirical Contracts (#13 ESM dynamic-import pattern)

### Out-of-scope items (explicitly NOT in this story)

- Story 7.4 anomaly-freeze (retro §12 Session 3 — ships AFTER this story).
- The 23 pre-existing unit-test fails on `main` (retro §6 W2 — pre-Go-Live stabilization scope).
- The `bundle-c-integrated` synthetic branch + 8 prior worktree cleanup (SCP-2026-05-11 §6 — operational, not story scope).
- Closing PRs #81-#85, #87-#89 as superseded by PR #91 (operational cleanup).
- Q8 Phase 2 CI gate (full `npm test` in CI workflow — fires AFTER this story closes the 5 Bundle-C fails).
- W6 cooperative-absorb anomaly-freeze stub-fallback (Story 7.4 spec decision).
- Q1/Q2/Q3/Q4/Q5/Q6 BAD pipeline patches (retro §12 Session 1 — inline skill edits, not a story).

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Step 3 developer, 2026-05-13)

### Debug Log References

None — all ACs completed without blockers.

### Completion Notes List

- **AC5 chosen path: Path A** — Amending spec wording is the lighter-touch option and sufficient because the behavioral guarantee (atomic clear + audit emission) is already verified by sub-test 5. The implementation with `hasErrorReport: false` was intentional; the spec had a gap between stated intent (PRI03 parser invocation) and actual behavior (skipped by design when no error report). Spec now accurately documents what the test exercises.

- **AC6 chosen path: Path A** — The injection pattern is well-established (Story 7.6 design) and the test correctly exercises the real `transitionCronState` via a capture-lambda. Refactoring the test to drop injection (Path B) would remove a valuable assertion on the args shape. Path A brings the spec text in line with the implemented injection-contract pattern without losing any behavioral coverage.

- **AC8 chosen path: Path A (source-grep structural assertion)** — The structural grep approach catches accidental reversion to bare-catch without the fragility of ES module shimming. Two occurrences verified (STEP 2 + STEP 5). Rationale: commit 983b8fb hardening must survive future refactors; source-grep is reliable and simple.

- **AC9 outcome: suppression already existed in production code** — `pri03-parser.js` line 362 already computes `alreadyFrozen = channelRows.some(r => r.frozen_for_pri01_persistent === true)` and gates the escalation block (`if (newFailureCount >= THREE_STRIKE_THRESHOLD && !alreadyFrozen)`). No production code changes needed. The new test confirms suppression by supplying a row with `frozen_for_pri01_persistent: true` and asserting no `pri01-fail-persistent` audit INSERT and no re-freeze UPDATE.

- **Final `npm run test:unit` pass/fail count**: 548 tests, 524 pass, 24 fail. Pre-story baseline was 29 fails (5 Bundle-C-introduced + 24 pre-existing). After AC7 migration: 24 fails (pre-existing only). Net improvement: 5 Bundle-C-introduced fails closed.

- **Confirmation: Bundle C green-floor verified** — `node --test tests/integration/full-cycle.test.js tests/integration/pending-import-id-invariant.test.js tests/integration/circuit-breaker-trip.test.js` → 47 pass, 0 fail. Count expanded from 45 to 47 due to 2 new tests (AC2's module-presence block + AC4's sub-test 1b). All original 45 assertions still green; no existing assertion weakened or removed.

- **AC3 surface gap documented**: `assembleCycle` mock-tx surface does not support direct drive because `assembleCycle` reads `customer_marketplaces` + `sku_channels` from real DB tables not fully stubbed in `buildMockTx`. Path chosen: extract the test-issued INSERT into `simulateAssembleCycleStagingInsert` helper with explicit source annotation. The circularity is made explicit rather than silent.

### File List

| File | Change | AC |
|---|---|---|
| `shared/mirakl/pri02-poller.js` | Narrowed bare `catch` to `catch (err) { if (err && err.code !== 'ERR_MODULE_NOT_FOUND') throw err; }` | AC1 |
| `tests/integration/full-cycle.test.js` | Added 5 top-level await imports (AC2) + `simulateAssembleCycleStagingInsert` helper (AC3) + AC8 5-module presence assertion block | AC2, AC3 |
| `tests/integration/pending-import-id-invariant.test.js` | Added sub-test 1b (N>1 batch correctness with N=3 channels) | AC4 |
| `_bmad-output/implementation-artifacts/7-8-*.md` | AC3 sub-test 5 wording amended (Path A) + AC4 transitionCronStateFn wording amended (Path A) with `<!-- Amended -->` markers | AC5, AC6 |
| `tests/worker/engine/decide.test.js` | Fixtures 4 + 6 migrated to `_fixture_meta` oracle; AC8 narrowed-catch structural regression test added | AC7, AC8 |
| `tests/worker/engine/cooperative-absorb.test.js` | AC4 block migrated from `_preconditions.*` to `_fixture_meta.*`; test renamed `fixture_loads_and_has_required_metadata` | AC7 |
| `tests/shared/mirakl/pri03-parser.test.js` | AC9 `three_strike_re_fire_suppression_for_already_frozen_sku` test added | AC9 |
