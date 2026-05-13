# Story 7.5: worker/src/engine/tier-classify.js — full transitions + atomic T2a→T2b write per F1

Status: ready-for-dev

<!-- Sharded 2026-05-13 by Bob (`bmad-create-story`) per Bundle C close-out retro §12 Session 3 ordering + deferred-work.md line 467 (3rd-sighting mechanism-trace pattern). -->
<!-- Source: _bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md Story 7.5 + SCP-2026-05-13 Path I ratification + bundle-c-close-out-retro-2026-05-13.md §12 Session 3 ordering. -->
<!-- NOT a Bundle C participant — not in `bundle_dispatch_orders:` or `merge_blocks:` in sprint-status.yaml. Solo dispatch from main. Ships BEFORE Story 7.7 per retro §12 Session 3 ordering (7.7's worker/src/safety/reconciliation.js calls applyTierClassification — Story 7.7 depends on Story 7.5). -->

## Story

As **the maintainer of the AD10 + F1 tier-classification contract**,
I want **`worker/src/engine/tier-classify.js` shipped as the engine-side `applyTierClassification` SSoT — implementing the 4-state {T1, T2a, T2b, T3} transition rules with the F1 atomic T2a→T2b dual-column write — wired into `worker/src/engine/decide.js` STEP 1 (no-competitors branch) + STEP 4 (post-position-determination)**,
so that **per-SKU tier columns update in lockstep with engine decisions, the dispatcher selects rows at the correct cadence after every transition, and the F1 amendment's atomic dual-column write closes the long-standing "dispatcher reads `tier='2b'` but `tier_cadence_minutes` still 15-min" race that would otherwise keep recently-promoted T2a rows checking at 15-min cadence forever.**

---

## Acceptance Criteria

> **Bundle C invariant guard** (non-negotiable across all ACs): the 3 Bundle C integration test files MUST stay green at ≥48/48 (post-Story 7.4 anomaly-freeze positive-assertion floor). Story 7.5 does NOT add new assertions to these files, but tier-transition changes touch dispatcher cadence behavior which Bundle C's `full-cycle.test.js` exercises for the 3 Story-7.5-bound fixtures.
> - [tests/integration/full-cycle.test.js](tests/integration/full-cycle.test.js)
> - [tests/integration/pending-import-id-invariant.test.js](tests/integration/pending-import-id-invariant.test.js)
> - [tests/integration/circuit-breaker-trip.test.js](tests/integration/circuit-breaker-trip.test.js)
>
> If any change in this story turns one of these red, STOP and re-shape — engine tier-transition wiring is not allowed to widen the Bundle C regression surface.

### AC1 — Ship `worker/src/engine/tier-classify.js` as the AD10+F1 SSoT module

> **Mechanism trace (cited verbatim per deferred-work.md line 467 + memory `feedback_trace_proposed_fixes` 3rd-sighting pattern — Story 6.3 wire-up, Story 7.8 fake-gate, Story 7.4 AC1 mechanism gap):**
>
> **Call chain (autocommit-per-statement, NOT BEGIN/COMMIT-wrapped):**
> 1. Cron tick: [worker/src/jobs/master-cron.js:38-55](worker/src/jobs/master-cron.js#L38-L55) — calls `dispatchCycle({ pool })`. Owns no tx.
> 2. Dispatcher loop: [worker/src/dispatcher.js:200-264](worker/src/dispatcher.js#L200-L264) — `client = await pool.connect()` per customer ([L205](worker/src/dispatcher.js#L205)), advisory lock ([L213](worker/src/dispatcher.js#L213)), then `await assembleCycle(client, ...)` at [L243](worker/src/dispatcher.js#L243). **NO BEGIN/COMMIT wraps the assembleCycle call.** The only BEGIN/COMMITs in dispatcher.js are micro-tx around cycle-start / cycle-end audit events at [L134-L159](worker/src/dispatcher.js#L134-L159) — irrelevant to per-SKU statement ordering.
> 3. Cycle-assembly per-SKU loop: [worker/src/cycle-assembly.js:106-217](worker/src/cycle-assembly.js#L106-L217) — `await tx.query(...)` and `await writeAuditEvent(...)` each autocommit at statement boundary. Tx variable name is misleading: it is the dispatcher's checked-out PoolClient in autocommit mode, NOT an active BEGIN/COMMIT transaction.
> 4. Engine STEP 4: [worker/src/engine/decide.js:154-214](worker/src/engine/decide.js#L154-L214) — `ownPosition` is computed (line 163). After STEP 4 branches (CASE A contested / CASE B winning) yield `decisionAction`, Story 7.5 inserts the `applyTierClassification` call.
> 5. Engine STEP 1 no-competitors branch: [worker/src/engine/decide.js:100-110](worker/src/engine/decide.js#L100-L110) — already returns `auditEvents: [EVENT_TYPES.TIER_TRANSITION]` and includes the inline comment *"Story 7.5 handles tier column DB writes; engine returns the event here."*. Story 7.5 fulfils that wire-up: adds the DB UPDATE via `applyTierClassification` BEFORE the existing return.
>
> **Tx topology — ratified by SCP-2026-05-13 (Path I):** autocommit-per-statement at the per-SKU level. There is no outer cycle-level BEGIN/COMMIT. Each `await tx.query(...)` commits at its own boundary. See [_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-13.md](_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-13.md) §1 "Investigation finding" + the Story 7.4 / Story 7.6 inline-`sendCriticalAlert` precedents.
>
> **Statement ordering inside `applyTierClassification`** (Path I autocommit-equivalent atomicity):
> - **Step 1:** `await tx.query('UPDATE sku_channels SET tier=$1, tier_cadence_minutes=$2[, last_won_at=$3] WHERE id=$N AND tier=$expectedFromTier', [...])` — the F1 atomic dual-column write. Autocommits at statement boundary; dispatcher's next `SELECT` sees both columns at their new values (no race window).
> - **Step 2:** Returns metadata `{ tierTransitioned, fromTier, toTier, reason }` to caller (decide.js STEP 1 or STEP 4).
> - **Step 3 (caller-side, decide.js):** If `tierTransitioned === true`, appends `EVENT_TYPES.TIER_TRANSITION` to engine's outgoing `auditEvents` array. The STEP 1 no-competitors branch already includes `TIER_TRANSITION` unconditionally — preserved (matches fixture `p11-tier3-no-competitors.json` `_expected.auditEvent` even on steady-state T3-stays-T3 per current code + Bundle C 48/48 floor — see Anti-patterns).
> - **Step 4 (further-out caller, cycle-assembly.js [L199-L211](worker/src/cycle-assembly.js#L199-L211)):** iterates `auditEvents` and calls `writeAuditEvent({ tx, eventType: 'tier-transition', payload, ... })` — `INSERT INTO audit_log` autocommits at its own boundary.
>
> **Atomicity guarantee — what F1 actually closes:** F1's race ("dispatcher reads `tier='2b'` but `tier_cadence_minutes=15`") is closed by issuing BOTH columns in ONE UPDATE statement at Step 1. Postgres applies single-statement UPDATEs atomically (no inter-column read tearing visible to other transactions / cron ticks). The audit insert at Step 4 is a SEPARATE sequenced statement — ordering preserved by JS control flow: if the UPDATE throws (DB error / RLS deny), control never reaches Step 2-4 and no `tier-transition` row is INSERTed. If the UPDATE succeeds and the audit INSERT fails later, the tier change is committed but the audit row is missing — acceptable autocommit failure mode per SCP-2026-05-13 ratification (matches Story 7.6 per-SKU CB + Story 7.4 anomaly-freeze precedents).
>
> **Why this is "mirror cron-state.js / circuit-breaker.js / anomaly-freeze.js" in spirit, NOT in literal Pattern A:** The mirror modules above do `UPDATE + writeAuditEvent` co-located inside one function. Story 7.5 splits the UPDATE (inside `applyTierClassification`) from the audit `INSERT` (inside cycle-assembly's existing emit loop) for ONE reason: [worker/src/engine/decide.js:16-17](worker/src/engine/decide.js#L16-L17) documents the locked architectural rule *"decide.js does NOT import writeAuditEvent. Audit events are returned in the auditEvents[] array and emitted by the caller (cycle-assembly.js)."* — and the existing Bundle C green-floor `full-cycle.test.js` AC1 oracle ([L266-L271](tests/integration/full-cycle.test.js#L266-L271)) asserts on `result.auditEvents.includes(expected.auditEvent)`, not on captured audit_log INSERTs. Inlining `writeAuditEvent` inside `applyTierClassification` would either (a) double-emit if decide.js also appends to `auditEvents`, or (b) break the existing fixture assertion if decide.js stops appending. The autocommit-per-statement equivalence (Path I) makes the two patterns functionally identical: the UPDATE statement autocommits, then the INSERT statement autocommits, both in the same caller-supplied client. Pattern C preserves decide.js's architectural rule + the Bundle C test contract without sacrificing the F1 atomicity invariant.

**Given** [worker/src/engine/tier-classify.js](worker/src/engine/tier-classify.js) does not yet exist on `main` (verified — only the scan-time-classifier sibling [worker/src/lib/tier-classify.js](worker/src/lib/tier-classify.js) shipped in Story 4.4, with a self-documenting NOTE block at [L9-L11](worker/src/lib/tier-classify.js#L9-L11) explicitly distinguishing the two files),

**When** I create the engine-side module per the AD10 + F1 contract,

**Then** the module:

- Exports `applyTierClassification({ tx, skuChannel, currentPosition, hasCompetitors })` as a NAMED export (no default export — architecture convention).
- Performs the tier-transition decision per the 4-state rules below.
- For real transitions: issues ONE `UPDATE sku_channels SET tier=$1, tier_cadence_minutes=$2[, last_won_at=$3], updated_at=NOW() WHERE id=$N AND tier=$expectedFromTier` statement on the caller-supplied `tx`. The trailing `AND tier=$expectedFromTier` is an **optimistic-concurrency guard** mirroring [shared/state/cron-state.js:132-137](shared/state/cron-state.js#L132-L137) — if a concurrent process already transitioned the row, rowCount === 0 and the function returns `{ tierTransitioned: false, reason: 'concurrent-transition-detected' }` without throwing (this is a quiet race-loser; the winning tx already emitted the audit event).
- For steady-state (no transition needed): issues NO UPDATE.
- Returns `{ tierTransitioned: boolean, fromTier: string, toTier: string, reason: string }` — caller uses `tierTransitioned` to decide whether to append `EVENT_TYPES.TIER_TRANSITION` to engine's `auditEvents`.
- Imports ONLY: `tier` enum reference (informational — no module needed; tier values are inline literals), pino logger via `createWorkerLogger()` ([shared/logger.js](shared/logger.js)). **Does NOT import `writeAuditEvent`** — Pattern C (audit emission stays caller-side in cycle-assembly's loop).

**4-state transition rules (AD10 + F1) — full case enumeration:**

| Precondition (current sku_channel state)               | Engine signal (`currentPosition`, `hasCompetitors`)              | Action                                                                                       | Audit signal      |
|--------------------------------------------------------|------------------------------------------------------------------|----------------------------------------------------------------------------------------------|-------------------|
| `tier='1'`                                             | `currentPosition===1` AND `hasCompetitors===true`                | **T1 → T2a**: UPDATE `tier='2a', tier_cadence_minutes=15, last_won_at=NOW()` WHERE `tier='1'` | `tier-transition` |
| `tier='2a'`                                            | `currentPosition===1` AND `last_won_at >= NOW() - 4h`            | **T2a stays T2a**: NO UPDATE (steady-state within 4h window)                                 | (none from STEP 4) |
| `tier='2a'`                                            | `currentPosition===1` AND `last_won_at <  NOW() - 4h`            | **T2a → T2b (F1)**: UPDATE `tier='2b', tier_cadence_minutes=45` WHERE `tier='2a'` (F1 atomic dual-column write) | `tier-transition` |
| `tier IN ('2','2a','2b')` (legacy '2' tolerated; see Anti-patterns) | `currentPosition > 1`                                            | **{T2, T2a, T2b} → T1**: UPDATE `tier='1', tier_cadence_minutes=15` WHERE `tier=<current>` (last_won_at preserved — analytics signal per epic AC1) | `tier-transition` |
| `tier='3'`                                             | `hasCompetitors===true` AND `currentPosition===1`                | **T3 → T2a**: UPDATE `tier='2a', tier_cadence_minutes=15, last_won_at=NOW()` WHERE `tier='3'` | `tier-transition` |
| `tier='3'`                                             | `hasCompetitors===true` AND `currentPosition > 1`                | **T3 → T1**: UPDATE `tier='1', tier_cadence_minutes=15` WHERE `tier='3'` (last_won_at stays null) | `tier-transition` |
| `tier='3'`                                             | `hasCompetitors===false`                                         | **T3 stays T3**: NO UPDATE (steady-state); decide.js STEP 1 already returns `TIER_TRANSITION` in auditEvents per [L100-L110](worker/src/engine/decide.js#L100-L110) — Story 7.5 does NOT change this (fixture `p11-tier3-no-competitors.json` `_expected.auditEvent='tier-transition'` is the locked oracle per SCP Amendment 4) | (caller-managed at STEP 1, NOT this AC) |
| `tier IN ('1','2','2a','2b')`                          | `hasCompetitors===false`                                         | **{T1, T2a, T2b} → T3**: UPDATE `tier='3', tier_cadence_minutes=1440` WHERE `tier=<current>` (last_won_at preserved — analytics signal) — competitors disappeared since last cycle | `tier-transition` |
| `tier='1'` AND `currentPosition > 1`                   | `hasCompetitors===true`                                          | **T1 stays T1**: NO UPDATE (still losing — no transition needed)                             | (none)            |
| `tier='2b'`                                            | `currentPosition===1` AND `hasCompetitors===true`                | **T2b stays T2b**: NO UPDATE (still winning at promoted cadence)                             | (none)            |

**Inputs (named-param shape):**
- `tx` — caller-supplied PoolClient (autocommit-per-statement per SCP-2026-05-13 Path I). MUST have `.query()`.
- `skuChannel` — full `sku_channels` row including `id`, `tier`, `tier_cadence_minutes`, `last_won_at` columns.
- `currentPosition` — integer (1 for "in 1st place", >1 for "contested"). Computed by decide.js STEP 4 ([decide.js:163](worker/src/engine/decide.js#L163)) and passed in.
- `hasCompetitors` — boolean. `filteredOffers.length > 0` (computed by decide.js STEP 1 ([decide.js:85](worker/src/engine/decide.js#L85)) and passed in).

**Return shape:**
```js
{
  tierTransitioned: boolean,
  fromTier: string,        // e.g., '2a'
  toTier: string,          // e.g., '2b'  (same as fromTier when tierTransitioned=false)
  reason: string,          // e.g., 't2a-elapsed-4h' | 'won-1st-place' | 'lost-1st-place' | 'no-transition-stable' | 'concurrent-transition-detected'
}
```

**`tier_cadence_minutes` value map (per AD10 + frontmatter pre-locked decisions):**
- T1: 15 min
- T2a: 15 min
- T2b: 45 min
- T3: 1440 min (daily)

**ESLint constraints enforced by this module:**
- **Constraint #18** (no console.log): pino via `createWorkerLogger()`; never `console.log`.
- **Constraint #21** (no raw INSERT audit_log outside `shared/audit/writer.js`): not applicable — Pattern C, module does no audit INSERT.
- **Constraint #22** (no float-price math outside `shared/money/index.js`): not applicable — tier values are enum strings; `tier_cadence_minutes` is integer minutes; no money arithmetic in this module.
- **Constraint #24** (worker-must-filter-by-customer): the UPDATE filters by `sku_channels.id` (unique per-tenant via natural FK chain). Mirror pattern: [worker/src/safety/anomaly-freeze.js:110-117](worker/src/safety/anomaly-freeze.js#L110-L117) does the same — the `WHERE id=$N` predicate is the locked Bundle B / AD12 reference. The dispatcher pre-scopes the row to one tenant; engine receives only that tenant's rows. ESLint pragma comment NOT required (matches anomaly-freeze.js shipping).
- **No default export**: only named exports (`applyTierClassification`).
- **No `.then()` chains**: async/await only.

**Reference SSoT pattern:** mirror [shared/state/cron-state.js](shared/state/cron-state.js) for the optimistic-concurrency `WHERE id=$N AND tier=$expectedFromTier` guard shape + the Bundle B atomicity language. Tier 7.5 deviates from cron-state.js's Pattern A only in audit-emission location (Pattern C — caller-side, see Mechanism trace above for the deviation rationale).

**Source:** epic-7-engine-safety.md Story 7.5 AC#1 + AD10 + F1 amendment + SCP-2026-05-13 Path I autocommit ratification.

### AC2 — Wire `applyTierClassification` into `decide.js` STEP 1 (no-competitors branch) + STEP 4 (post-position-determination)

**Given** [worker/src/engine/decide.js:100-110](worker/src/engine/decide.js#L100-L110) currently returns `auditEvents: [EVENT_TYPES.TIER_TRANSITION]` on the no-competitors HOLD path WITHOUT issuing any DB UPDATE (inline comment "Story 7.5 handles tier column DB writes; engine returns the event here." — the wire-up is the explicit story-deferral target),

**AND** [worker/src/engine/decide.js:154-214](worker/src/engine/decide.js#L154-L214) STEP 4 computes `ownPosition` (line 163) and produces `decisionAction` + `decisionAuditEvents` WITHOUT calling tier-classify (STEP 4 currently has NO tier-transition awareness — the tier column is only updated at scan time per Story 4.4),

**When** I add the engine-side wire-up,

**Then** decide.js:

- **STEP 1 patch (no-competitors branch, [L100-L110](worker/src/engine/decide.js#L100-L110)):** before the existing `return`, call:
   ```js
   await applyTierClassification({ tx, skuChannel, currentPosition: null, hasCompetitors: false });
   ```
   - `currentPosition: null` because no competitors means no position is meaningful — the function only reads `hasCompetitors === false` to drive the T3-stays-T3 branch (or transition from another tier into T3).
   - The function's return is intentionally IGNORED for STEP 1 (`tierTransitioned: bool` doesn't change the auditEvents — the existing line 107 already includes `TIER_TRANSITION` unconditionally to match fixture `p11-tier3-no-competitors.json`).
   - If the UPDATE throws (DB error / RLS deny), control never reaches the existing `return` — decideForSkuChannel propagates the error to cycle-assembly which catches at the per-customer level ([dispatcher.js:265-266](worker/src/dispatcher.js#L265-L266)). No `tier-transition` audit row is INSERTed (autocommit failure-mode preserves ordering).

- **STEP 4 patch (post-`ownPosition` determination, after [L213](worker/src/engine/decide.js#L213)):** after the `ownPosition`-driven CASE A / CASE B branching sets `decisionAction` + `decisionAuditEvents`, but BEFORE the STEP 5 CB check at [L220](worker/src/engine/decide.js#L220), call:
   ```js
   const tierResult = await applyTierClassification({
     tx,
     skuChannel,
     currentPosition: ownPosition,
     hasCompetitors: true,  // STEP 4 only fires when filteredOffers.length > 0 — verified by STEP 1's early-return at L100-L110
   });
   if (tierResult.tierTransitioned) {
     decisionAuditEvents = [...decisionAuditEvents, EVENT_TYPES.TIER_TRANSITION];
   }
   ```
   - `currentPosition: ownPosition` — simplified to 1 (winning) or 2 (contested) per [decide.js:163](worker/src/engine/decide.js#L163). This is sufficient for the transition rules (the AD10 spec only needs "in 1st place" vs "not in 1st place", not the precise rank).
   - `hasCompetitors: true` — STEP 4 only executes after STEP 1's early-return when `filteredOffers.length === 0` does NOT fire (no STEP 1 return → has competitors). Hardcoded `true` is safe and reads cleaner than threading `filteredOffers.length > 0` through.
   - The append to `decisionAuditEvents` happens ONLY when `tierTransitioned === true` — steady-state T2a-stays-T2a (e.g., fixture `p11-tier2a-recently-won-stays-watched.json`) does NOT add `tier-transition` to auditEvents (fixture's `_expected.auditEvent` is `'ceiling-raise-decision'`, not `'tier-transition'`).
   - The STEP 5 CB check ([L220-L243](worker/src/engine/decide.js#L220-L243)) runs AFTER tier-classify. This is intentional: tier transitions reflect the engine's current snapshot (position + competitors); they should happen even if STEP 5 subsequently trips the CB and HOLDs the price change. The tier column tracks the SKU's competitive state, not whether we actually pushed a price.

- **Statement-ordering invariant:** Within decide.js, the UPDATE from `applyTierClassification` runs BEFORE STEP 5's CB check and BEFORE decide.js's `return`. cycle-assembly's audit emission loop ([L199-L211](worker/src/cycle-assembly.js#L199-L211)) iterates `auditEvents` and emits `tier-transition` AFTER decide.js returns. The two statements autocommit independently in the same caller-supplied `tx`; if the UPDATE throws, decide.js throws, cycle-assembly never reaches the audit emission. Path I autocommit semantics ratified per SCP-2026-05-13.

**Import shape** (top of decide.js, alongside existing imports at [L11-L14](worker/src/engine/decide.js#L11-L14)):
```js
import { applyTierClassification } from './tier-classify.js';
```

Static import (NOT dynamic `await import` with `ERR_MODULE_NOT_FOUND` catch) — the tier-classify module ships on `main` in THIS story. Mirrors Story 7.4 AC2 static-import discipline: no stub-fallbacks for production modules per SCP Amendment 7.

**Scope guard — STEP 2 + STEP 5 dynamic-import patterns STAY:** [decide.js:117-129](worker/src/engine/decide.js#L117-L129) (STEP 2 cooperative-absorb dynamic import) and [decide.js:222-238](worker/src/engine/decide.js#L222-L238) (STEP 5 circuit-breaker dynamic import) — these narrowed-catch patterns remain unchanged. Story 7.5 only adds the STEP 1 + STEP 4 tier-classify wire-up; the STEP 2 / STEP 5 bridges are out-of-scope. Story 7.9's AC8 invariant test for the `decide.js` narrowed-catch pattern stays applicable.

**Source:** epic-7-engine-safety.md Story 7.5 AC#1 + [decide.js:100-110](worker/src/engine/decide.js#L100-L110) deferred wire-up comment + Story 7.4 AC2 precedent for static-import discipline.

### AC3 — Fixture `p11-tier2a-recently-won-stays-watched.json` passes via existing oracle (no fixture change)

**Given** [tests/fixtures/p11/p11-tier2a-recently-won-stays-watched.json](tests/fixtures/p11/p11-tier2a-recently-won-stays-watched.json) encodes:
- `_fixture_meta.skuChannel_overrides`: `tier: '2a'`, `tier_cadence_minutes: 15`, `last_won_at: <set in test: NOW - 2h>`, `list_price_cents: 3500`, `current_price_cents: 3599`, `pending_import_id: null`.
- `_expected`: `action: 'CEILING_RAISE'`, `newPriceCents: 3749`, `auditEvent: 'ceiling-raise-decision'`, `priority: 'rotina'`, `tierStay: '2a'`.

**When** the existing AC1 oracle loop in [tests/integration/full-cycle.test.js:226-274](tests/integration/full-cycle.test.js#L226-L274) iterates this fixture with the new Story 7.5 wire-up in place,

**Then** the test asserts:
- `result.action === 'CEILING_RAISE'` (CASE B winning + ceiling-raise headroom — unchanged from current behavior).
- `result.newPriceCents === 3749` (STEP 3 math unchanged).
- `result.auditEvents.includes('ceiling-raise-decision')` (STEP 4 emit unchanged).
- The new `applyTierClassification` call inside STEP 4 fires with `currentPosition: 1, hasCompetitors: true`; reads `skuChannel.tier === '2a'` AND `last_won_at` < 4h ago → returns `{ tierTransitioned: false, fromTier: '2a', toTier: '2a', reason: 'no-transition-stable' }`. The captured mock-tx `_queries` array contains NO `UPDATE sku_channels SET tier=...` query attributable to tier-classify (Bundle C buildMockTx returns rows for any SQL pattern; the assertion is that the SQL string never matches a tier-transition UPDATE shape).
- `result.auditEvents` does NOT include `'tier-transition'` (steady-state T2a — the fixture's `_expected.tierStay: '2a'` is informational, NOT an auditEvent oracle).
- Bundle C floor `full-cycle.test.js` stays at ≥48/48.

**Scope guards:**
- The fixture file is NOT modified. SCP Amendment 4: `_expected` is the sole oracle; no hand-coded expectation table in any test reads the fixture differently.
- No new fixture fields are added. The `tierStay: '2a'` field is informational metadata only — it does NOT participate in the oracle loop's assertion at [full-cycle.test.js:266-271](tests/integration/full-cycle.test.js#L266-L271).
- The `last_won_at` test-time injection (`new Date(Date.now() - 2*60*60*1000).toISOString()`) is the responsibility of `buildMockSkuChannel` ([full-cycle.test.js:80-105](tests/integration/full-cycle.test.js#L80-L105)) — verify the existing helper either applies the `<set in test: ...>` string literal as-is (a string is treated as already-stale-but-still-2a-window per ISO parse) OR — preferred — extend `buildMockSkuChannel` to detect the angle-bracket sentinel and substitute `new Date(Date.now() - 2*60*60*1000).toISOString()`. Document the chosen path in Dev Agent Record.

**Source:** epic-7-engine-safety.md Story 7.5 AC#3 + SCP Amendment 4 (fixture sole oracle) + Bundle C full-cycle.test.js AC1 oracle pattern.

### AC4 — Fixture `p11-tier3-no-competitors.json` passes via existing oracle (no fixture change, no audit-event drift)

**Given** [tests/fixtures/p11/p11-tier3-no-competitors.json](tests/fixtures/p11/p11-tier3-no-competitors.json) encodes:
- `_fixture_meta.skuChannel_overrides`: `tier: '3'`, `tier_cadence_minutes: 1440`, `list_price_cents: 3000`, `current_price_cents: 2999`, `pending_import_id: null`.
- `_expected`: `action: 'HOLD'`, `newPriceCents: null`, `auditEvent: 'tier-transition'`, `tier: '3'`.

**AND** the engine path is: STEP 1 filter chain → `filteredOffers.length === 0` (self-filter removes the only "Easy - Store" offer) → STEP 1 early-return at [decide.js:100-110](worker/src/engine/decide.js#L100-L110) with `auditEvents: [TIER_TRANSITION]`,

**When** the existing AC1 oracle loop iterates this fixture with the new Story 7.5 wire-up,

**Then** the test asserts:
- `result.action === 'HOLD'` (STEP 1 no-competitors path).
- `result.newPriceCents === null` (no write).
- `result.auditEvents.includes('tier-transition')` — STILL TRUE. STEP 1 line 107 unconditionally puts `TIER_TRANSITION` in auditEvents (existing behavior preserved per AC2 STEP 1 patch — the new `applyTierClassification` call is added BEFORE the existing return, NOT in place of the existing TIER_TRANSITION inclusion).
- The new `applyTierClassification({ tx, skuChannel, currentPosition: null, hasCompetitors: false })` call inside STEP 1 returns `{ tierTransitioned: false, fromTier: '3', toTier: '3', reason: 'no-transition-stable' }` — NO UPDATE issued because `skuChannel.tier === '3'` already.
- Bundle C floor `full-cycle.test.js` stays at ≥48/48.

**Documented oracle deviation (flag-only, do NOT fix in this story):** Epic-spec Story 7.5 AC#4 wording at [04-epic-7-engine-safety.md:134](_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md#L134) says *"tier classified as '3', cadence = 1440 (daily), no audit event for steady-state"* — which contradicts the fixture's `_expected.auditEvent: 'tier-transition'` for the steady-state case AND contradicts the current decide.js STEP 1 line 107 behavior. Per SCP Amendment 4 + Pedro's brief 2026-05-13 ("the 3 fixtures this story binds MUST use `_expected` as the test oracle"), the FIXTURE wins. The epic AC wording is the divergent one. **Recommend:** flag for Epic 7 retro / Bundle B-or-pattern follow-up — either flip the fixture (would require a new SCP) or amend the epic AC wording. Do NOT attempt to "fix" this divergence in Story 7.5: it would either (a) require flipping a sealed fixture (forbidden by SCP Amendment 4), or (b) drift from the Bundle C 48/48 green floor that depends on the current emit-on-no-competitors path.

**Source:** epic-7-engine-safety.md Story 7.5 AC#4 (text) vs fixture `_expected.auditEvent='tier-transition'` (oracle) + SCP Amendment 4 + Pedro's brief 2026-05-13 (fixture wins).

### AC5 — Fixture `p11-tier3-then-new-competitor.json` passes via existing oracle (T3→T1 transition fires, hold-floor-bound oracle satisfied)

**Given** [tests/fixtures/p11/p11-tier3-then-new-competitor.json](tests/fixtures/p11/p11-tier3-then-new-competitor.json) encodes:
- `_fixture_meta.skuChannel_overrides`: `tier: '3'`, `tier_cadence_minutes: 1440`, `list_price_cents: 5000`, `current_price_cents: 4999`, `pending_import_id: null`.
- `_fixture_meta.customerMarketplace_overrides`: `max_discount_pct: 0.05`.
- `_expected`: `action: 'HOLD'`, `newPriceCents: null`, `auditEvent: 'hold-floor-bound'`, `tierTransition: '3→1'` (informational only).
- P11 offers: 1 competitor at 4599, 1 self at 4999 → post-filter 1 offer (4599) → has competitors.

**AND** the engine path is: STEP 1 has competitors → STEP 3 floor = ceil(5000 × 0.95) = 4750 → STEP 4 CASE A (ownPosition=2: 4999>4599) → targetUndercut=4598 → candidate=max(4598, 4750)=4750 → 4750 ≥ 4599 → HOLD floor-bound → `decisionAuditEvents = [HOLD_FLOOR_BOUND]`,

**When** the existing AC1 oracle loop iterates this fixture with the new Story 7.5 wire-up,

**Then** the test asserts:
- `result.action === 'HOLD'` (STEP 4 CASE A floor-bound).
- `result.newPriceCents === null` (HOLD does not produce a candidate write).
- `result.auditEvents.includes('hold-floor-bound')` — primary oracle satisfied (the fixture's `_expected.auditEvent` is `hold-floor-bound`, NOT `tier-transition`; the `.includes()` check only positively asserts the named event is present).
- The new `applyTierClassification({ tx, skuChannel, currentPosition: 2, hasCompetitors: true })` call inside STEP 4 reads `skuChannel.tier === '3'`, `currentPosition > 1`, `hasCompetitors === true` → matches the **T3 → T1** transition row of the case table → issues `UPDATE sku_channels SET tier='1', tier_cadence_minutes=15, updated_at=NOW() WHERE id=$N AND tier='3'` → returns `{ tierTransitioned: true, fromTier: '3', toTier: '1', reason: 'lost-1st-place-from-tier3' }`.
- `decisionAuditEvents` is extended to `['hold-floor-bound', 'tier-transition']` (decide.js STEP 4 appends after `tierResult.tierTransitioned === true`).
- `result.auditEvents` includes BOTH `'hold-floor-bound'` AND `'tier-transition'` — `.includes('hold-floor-bound')` passes (the fixture's oracle); `.includes('tier-transition')` is incidentally TRUE but NOT asserted by the fixture (informational `_expected.tierTransition: '3→1'` is NOT part of the oracle loop).
- The captured mock-tx `_queries` array contains the `UPDATE sku_channels SET tier='1', ...` statement (verify via test inspection — the buildMockTx capture supports this).
- Bundle C floor `full-cycle.test.js` stays at ≥48/48.

**Source:** epic-7-engine-safety.md Story 7.5 AC#5 + Bundle C full-cycle.test.js AC1 oracle pattern.

### AC6 — Unit tests for `tier-classify.js` (full transition table + F1 atomic write verification + statement-ordering invariant)

**Given** the new SSoT module needs its own unit-test surface (mirroring [tests/worker/safety/anomaly-freeze.test.js](tests/worker/safety/anomaly-freeze.test.js) for Story 7.4 + [tests/worker/safety/circuit-breaker.test.js](tests/worker/safety/circuit-breaker.test.js) for Story 7.6),

**When** I add unit tests under [tests/worker/engine/tier-classify.test.js](tests/worker/engine/tier-classify.test.js),

**Then** the test file covers (per SCP Amendment 4 — no hand-coded expectation tables paralleling a fixture: each test below uses SYNTHETIC `skuChannel` constructs because the 3 fixtures only cover 3 of the 8 transition-table rows; the synthetic tests are NOT mirror-fixtures):

1. **T1 → T2a transition (won 1st place)**:
   - Synthetic skuChannel: `{ id: 'sc-1', tier: '1', tier_cadence_minutes: 15, last_won_at: null }`.
   - Call: `applyTierClassification({ tx: mockTx, skuChannel, currentPosition: 1, hasCompetitors: true })`.
   - Asserts:
     - `mockTx._queries[0].sql` matches `/UPDATE sku_channels.*SET tier = \$1.*tier_cadence_minutes = \$2.*last_won_at = \$3.*WHERE id = \$4 AND tier = \$5/` (regex; flexible param order acceptable as long as both tier columns + last_won_at appear in SET clause and id + tier appear in WHERE).
     - `mockTx._queries[0].params` includes `'2a'`, `15`, and `'1'` (expected fromTier guard).
     - Return value: `{ tierTransitioned: true, fromTier: '1', toTier: '2a', reason: 'won-1st-place' }` (exact `reason` slug accepted from {'won-1st-place', 'won-1st-place-from-tier1'}; document chosen slug in Dev Agent Record).

2. **T2a → T2b atomic dual-column write (F1 mechanism verification) — load-bearing assertion**:
   - Synthetic skuChannel: `{ id: 'sc-2', tier: '2a', tier_cadence_minutes: 15, last_won_at: new Date(Date.now() - 5 * 60 * 60 * 1000) }` (5 hours ago).
   - Call: `applyTierClassification({ tx: mockTx, skuChannel, currentPosition: 1, hasCompetitors: true })`.
   - **F1 atomicity assertion** (load-bearing per Pedro's brief 2026-05-13 mechanism-trace discipline):
     - `mockTx._queries[0].sql` includes the substring `SET tier = $1, tier_cadence_minutes = $2` (or vice-versa with `$1, $2` swapped) — verifying BOTH columns appear in ONE SET clause of ONE UPDATE statement. **The test MUST fail if `tier` and `tier_cadence_minutes` appear in TWO separate UPDATE statements** (the F1 race scenario — verify by counting `UPDATE sku_channels` occurrences in `_queries`: exactly 1 expected).
     - `mockTx._queries[0].params` includes `'2b'` AND `45` (both dual-write values present).
   - Return value: `{ tierTransitioned: true, fromTier: '2a', toTier: '2b', reason: 't2a-elapsed-4h' }` (exact `reason` slug from {'t2a-elapsed-4h', 't2a-4h-elapsed', 't2a-promote'}; document choice).

3. **T2a stays T2a (within 4h window — steady-state)**:
   - Synthetic skuChannel: `{ id: 'sc-3', tier: '2a', tier_cadence_minutes: 15, last_won_at: new Date(Date.now() - 2 * 60 * 60 * 1000) }` (2 hours ago — still within 4h window).
   - Call: `applyTierClassification({ tx: mockTx, skuChannel, currentPosition: 1, hasCompetitors: true })`.
   - Asserts:
     - `mockTx._queries.length === 0` (NO UPDATE issued — steady-state).
     - Return value: `{ tierTransitioned: false, fromTier: '2a', toTier: '2a', reason: 'no-transition-stable' }`.

4. **{T2a, T2b} → T1 on losing 1st place (currentPosition > 1)**:
   - Synthetic skuChannel A: `{ id: 'sc-4a', tier: '2a', tier_cadence_minutes: 15, last_won_at: <some past date> }`.
   - Synthetic skuChannel B: `{ id: 'sc-4b', tier: '2b', tier_cadence_minutes: 45, last_won_at: <some past date> }`.
   - For each: Call `applyTierClassification({ tx: mockTx, skuChannel, currentPosition: 2, hasCompetitors: true })`.
   - Asserts:
     - UPDATE issued with `SET tier = '1', tier_cadence_minutes = 15` (last_won_at NOT in SET clause — preserved per epic AC1 line 130 "preserve `last_won_at` (analytics signal)").
     - The WHERE clause includes `tier = '2a'` (or `'2b'`) — the optimistic-concurrency guard uses the row's current tier as `expectedFromTier`.
     - Return value: `{ tierTransitioned: true, fromTier: '2a' | '2b', toTier: '1', reason: 'lost-1st-place' }`.

5. **T3 → T2a on new competitor + winning 1st place**:
   - Synthetic skuChannel: `{ id: 'sc-5', tier: '3', tier_cadence_minutes: 1440, last_won_at: null }`.
   - Call: `applyTierClassification({ tx: mockTx, skuChannel, currentPosition: 1, hasCompetitors: true })`.
   - Asserts:
     - UPDATE with `SET tier = '2a', tier_cadence_minutes = 15, last_won_at = NOW()`.
     - WHERE includes `tier = '3'`.
     - Return value: `{ tierTransitioned: true, fromTier: '3', toTier: '2a', reason: 'won-1st-place-from-tier3' }`.

6. **T3 → T1 on new competitor + losing**:
   - Synthetic skuChannel: `{ id: 'sc-6', tier: '3', tier_cadence_minutes: 1440, last_won_at: null }`.
   - Call: `applyTierClassification({ tx: mockTx, skuChannel, currentPosition: 2, hasCompetitors: true })`.
   - Asserts:
     - UPDATE with `SET tier = '1', tier_cadence_minutes = 15` (last_won_at NOT in SET clause — stays null).
     - WHERE includes `tier = '3'`.
     - Return value: `{ tierTransitioned: true, fromTier: '3', toTier: '1', reason: 'lost-1st-place-from-tier3' }`.

7. **T3 stays T3 (no competitors)**:
   - Synthetic skuChannel: `{ id: 'sc-7', tier: '3', tier_cadence_minutes: 1440, last_won_at: null }`.
   - Call: `applyTierClassification({ tx: mockTx, skuChannel, currentPosition: null, hasCompetitors: false })`.
   - Asserts:
     - `mockTx._queries.length === 0` (NO UPDATE — steady-state).
     - Return value: `{ tierTransitioned: false, fromTier: '3', toTier: '3', reason: 'no-transition-stable' }`.

8. **Optimistic-concurrency race-loser (rowCount === 0)**:
   - Synthetic skuChannel: `{ id: 'sc-8', tier: '1', tier_cadence_minutes: 15, last_won_at: null }` — engine signals T1→T2a transition expected.
   - mockTx returns `{ rowCount: 0 }` for the UPDATE (simulating concurrent transition by another process).
   - Asserts:
     - The UPDATE was attempted (1 captured query).
     - Return value: `{ tierTransitioned: false, fromTier: '1', toTier: '1', reason: 'concurrent-transition-detected' }` — quiet race-loss, NO throw (mirrors `ConcurrentTransitionError`'s intent in cron-state.js but without the error class because the engine cycle is idempotent on tier — next cycle will re-read state and converge).

9. **T1 ↔ T2b stable — no transition when engine signal doesn't drive transition**:
   - Synthetic skuChannel: `{ id: 'sc-9', tier: '2b', tier_cadence_minutes: 45, last_won_at: <some past date> }`.
   - Call: `applyTierClassification({ tx: mockTx, skuChannel, currentPosition: 1, hasCompetitors: true })` — already winning, already at T2b.
   - Asserts:
     - `mockTx._queries.length === 0` (NO UPDATE).
     - Return value: `{ tierTransitioned: false, fromTier: '2b', toTier: '2b', reason: 'no-transition-stable' }`.

10. **{T1, T2a, T2b} → T3 (competitors disappeared)**:
    - Synthetic skuChannel A: `{ id: 'sc-10a', tier: '1', tier_cadence_minutes: 15, last_won_at: null }`.
    - Synthetic skuChannel B: `{ id: 'sc-10b', tier: '2a', tier_cadence_minutes: 15, last_won_at: <some past date> }`.
    - Synthetic skuChannel C: `{ id: 'sc-10c', tier: '2b', tier_cadence_minutes: 45, last_won_at: <some past date> }`.
    - For each: Call `applyTierClassification({ tx: mockTx, skuChannel, currentPosition: null, hasCompetitors: false })`.
    - Asserts:
      - UPDATE issued with `SET tier = '3', tier_cadence_minutes = 1440` (last_won_at NOT in SET clause — preserved per analytics signal).
      - WHERE includes `tier = '1'` (or `'2a'`, `'2b'` respectively — the optimistic-concurrency guard uses the row's current tier).
      - Return value: `{ tierTransitioned: true, fromTier: '1'|'2a'|'2b', toTier: '3', reason: 'competitors-disappeared' }`.

**Mock-tx pattern:** mirror [tests/worker/safety/anomaly-freeze.test.js](tests/worker/safety/anomaly-freeze.test.js) (Story 7.4) or [tests/integration/full-cycle.test.js:135-178 `buildMockTx`](tests/integration/full-cycle.test.js#L135-L178) — `tx.query` captures `{ sql, params }` and returns configurable `{ rowCount, rows }`. Default response: `{ rowCount: 1, rows: [] }` (transition succeeds). Override for test 8 to simulate race.

**No `await import` env-stub required:** `tier-classify.js` does NOT transitively import `shared/resend/client.js` (no `sendCriticalAlert` consumed), so the `RESEND_API_KEY` env-stub + `await import` pattern from Story 7.4 AC8 is NOT needed here. Plain top-of-file static `import` of `applyTierClassification` is sufficient. Confirm during Task 6 that no transitive resend dependency exists; if surfacing one, apply the env-stub pattern per memory `project_resend_env_stub_import_pattern`.

**Source:** epic-7-engine-safety.md Story 7.5 AC#6 + memory `feedback_trace_proposed_fixes` (mechanism trace, F1 atomic-write assertion is load-bearing per 3-sighting pattern).

### AC7 — Run boot + lint + Bundle C floor verification

**Given** Story 7.5 ships a NEW production module + modifies decide.js + adds NEW unit tests,

**When** the dev completes Tasks 1-6,

**Then** the following commands ALL pass clean:

1. **Module boot test** (per memory `feedback_step5_import_path_boot_check`):
   - `node --check worker/src/engine/tier-classify.js` → no syntax error.
   - `node --check worker/src/engine/decide.js` → no syntax error (verifies the new import path resolves at parse time).

2. **Bundle C green floor (non-negotiable)**:
   - `node --test tests/integration/full-cycle.test.js tests/integration/pending-import-id-invariant.test.js tests/integration/circuit-breaker-trip.test.js` → ≥48 pass, 0 fail. (Post-Story-7.4 baseline expanded to 48 with the new `'anomaly-freeze'` positive assertion in full-cycle.test.js AC1.)
   - The 3 Story-7.5 fixtures (`p11-tier2a-recently-won-stays-watched`, `p11-tier3-no-competitors`, `p11-tier3-then-new-competitor`) pass within the AC1 oracle loop with NO inline expectation override.

3. **New unit tests pass**:
   - `node --test tests/worker/engine/tier-classify.test.js` → 10 of 10 pass.

4. **Existing unit tests do NOT regress**:
   - `node --test tests/worker/engine/decide.test.js` → all tests pass (verify the STEP 4 wire-up + STEP 1 wire-up don't break the existing 12 fixture-driven decision tests for Story 7.2).
   - `node --test tests/worker/engine/cooperative-absorb.test.js` → all tests pass (Story 7.3 unit tests).
   - `node --test tests/worker/safety/circuit-breaker.test.js` → all tests pass (Story 7.6 unit tests).
   - `node --test tests/worker/safety/anomaly-freeze.test.js` → all tests pass (Story 7.4 unit tests).

5. **Lint clean on touched files**:
   - `npm run lint` → no new lint errors on `worker/src/engine/tier-classify.js` OR on the patched `worker/src/engine/decide.js`.
   - Specifically verify `no-default-export`, `no-console`, `worker-must-filter-by-customer` rules do NOT flag the new module.

6. **Full unit suite floor**:
   - `npm run test:unit` (or equivalent target — verify against `package.json`) → total fail count does NOT regress beyond the post-Story-7.9 baseline of 23 pre-existing unit fails (per sprint-status.yaml line 173 + retro §W2). Newly-failing tests attributable to Story 7.5 are 0.

7. **No new migration**:
   - `npx supabase migration list` → no diff vs `main`. The required `sku_channels` columns (`tier`, `tier_cadence_minutes`, `last_won_at`) already exist per [supabase/migrations/202604301206_create_sku_channels.sql:17-21](supabase/migrations/202604301206_create_sku_channels.sql#L17-L21). The `tier_value` enum (`'1', '2a', '2b', '3'`) is already defined at [L1](supabase/migrations/202604301206_create_sku_channels.sql#L1).

**Source:** memory `feedback_step5_import_path_boot_check` + Bundle C close-out retro §W2 unit-test floor + SCP Amendment 4 fixture-oracle discipline.

---

## Tasks / Subtasks

> Tasks are grouped by AC. Each AC owns one task; sub-tasks decompose by file.

- [ ] **Task 1 (AC1)** — Create `worker/src/engine/tier-classify.js` SSoT module
  - [ ] Create [worker/src/engine/tier-classify.js](worker/src/engine/tier-classify.js) with `applyTierClassification` named export.
  - [ ] Add JSDoc typedef documenting params + return shape; reference `PayloadForTierTransition` from [shared/audit/event-types.js:260-264](shared/audit/event-types.js#L260-L264) in the module-level comment (informational — Story 7.5 does NOT emit audit events directly, Pattern C).
  - [ ] Implement the 8-row transition decision table per AC1 (T1→T2a / T2a-stays-T2a / T2a→T2b F1 / {T2,T2a,T2b}→T1 / T3→T2a / T3→T1 / T3-stays-T3 / T1-and-T2b-stable).
  - [ ] Issue ONE UPDATE statement per transition (F1 atomic dual-column write — `tier` AND `tier_cadence_minutes` in the same SET clause for T2a→T2b; analogous single-statement shapes for the other transitions).
  - [ ] Include optimistic-concurrency `WHERE id=$N AND tier=$expectedFromTier` guard; on rowCount === 0 → quiet race-loss return (NO throw).
  - [ ] Log via pino `createWorkerLogger()`; log levels: `info` on successful transition, `debug` on no-op/steady-state, `warn` on race-loss.
  - [ ] Verify no `console.log`, no default export, no `.then()`, no float math.
  - [ ] Run `node --check worker/src/engine/tier-classify.js` — boot test passes (per memory `feedback_step5_import_path_boot_check`).

- [ ] **Task 2 (AC2)** — Wire `applyTierClassification` into `decide.js`
  - [ ] Edit [worker/src/engine/decide.js:1-15](worker/src/engine/decide.js#L1-L15) — add `import { applyTierClassification } from './tier-classify.js';` (static import; NO dynamic import; NO try/catch fallback).
  - [ ] Edit [worker/src/engine/decide.js:100-110](worker/src/engine/decide.js#L100-L110) — before the existing `return`, add the STEP 1 `applyTierClassification` call per AC2. The existing `auditEvents: [EVENT_TYPES.TIER_TRANSITION]` line stays unchanged.
  - [ ] Edit [worker/src/engine/decide.js:213-220](worker/src/engine/decide.js#L213-L220) — after the STEP 4 CASE A / CASE B branching sets `decisionAction` + `decisionAuditEvents`, BEFORE STEP 5 CB check, add the STEP 4 `applyTierClassification` call per AC2. If `tierResult.tierTransitioned === true`, extend `decisionAuditEvents` to include `EVENT_TYPES.TIER_TRANSITION`.
  - [ ] Update the comment at [decide.js:101-103](worker/src/engine/decide.js#L101-L103) to remove the deferred-wire-up note ("Story 7.5 handles tier column DB writes") since the wire-up is now in place. Replace with: *"Tier transition fires via applyTierClassification (Story 7.5) ABOVE this return; engine returns the event slug in auditEvents per Pattern C — cycle-assembly's emit loop INSERTs the audit_log row."*.
  - [ ] Update the comment at [decide.js:16-17](worker/src/engine/decide.js#L16-L17) — preserved verbatim (Pattern C invariant: decide.js still does NOT import writeAuditEvent).
  - [ ] **Grep guard**: `grep -n "Story 7.5 handles tier column DB writes" worker/src/engine/decide.js` returns 0 matches after Task 2 lands.
  - [ ] Run `node --check worker/src/engine/decide.js` — boot test passes.

- [ ] **Task 3 (AC3)** — Verify `p11-tier2a-recently-won-stays-watched.json` passes via existing oracle
  - [ ] Run `node --test tests/integration/full-cycle.test.js` — fixture passes within the AC1 oracle loop with `action=CEILING_RAISE`, `auditEvent=ceiling-raise-decision`.
  - [ ] Verify `buildMockSkuChannel` at [full-cycle.test.js:80-105](tests/integration/full-cycle.test.js#L80-L105) handles the `<set in test: ...>` sentinel for `last_won_at` — either:
    - The helper already substitutes synthetic past-date (preferred — check existing impl).
    - OR the sentinel is parsed by `new Date(...)` and yields a valid 2h-ago value somehow — verify the actual injection path.
    - If neither — extend `buildMockSkuChannel` minimally to detect the angle-bracket sentinel and substitute `new Date(Date.now() - 2*60*60*1000).toISOString()`. Document the chosen path in Dev Agent Record.
  - [ ] If the helper needs the extension, the change MUST be backward-compatible for the other 16 fixtures (none currently use this sentinel — verify).

- [ ] **Task 4 (AC4)** — Verify `p11-tier3-no-competitors.json` passes via existing oracle (no audit-event regression)
  - [ ] Run `node --test tests/integration/full-cycle.test.js` — fixture passes within the AC1 oracle loop with `action=HOLD`, `auditEvent=tier-transition`.
  - [ ] Verify the new `applyTierClassification(hasCompetitors: false)` STEP 1 call does NOT issue any `UPDATE sku_channels SET tier=...` query (steady-state T3-stays-T3).
  - [ ] Document the epic-spec-vs-fixture deviation flag in Dev Agent Record (epic AC#4 says "no audit event for steady-state"; fixture says emit tier-transition; fixture wins per SCP Amendment 4).

- [ ] **Task 5 (AC5)** — Verify `p11-tier3-then-new-competitor.json` passes via existing oracle (T3→T1 transition fires)
  - [ ] Run `node --test tests/integration/full-cycle.test.js` — fixture passes within the AC1 oracle loop with `action=HOLD`, `auditEvent=hold-floor-bound`.
  - [ ] Verify `result.auditEvents` ALSO includes `'tier-transition'` (incidentally — not part of the fixture oracle, but verifies the T3→T1 transition fired).
  - [ ] Optional inspection: instrument `buildMockTx` to capture the `UPDATE sku_channels SET tier='1'` query for this fixture — document in Dev Agent Record what the captured SQL string looks like (for retro / future audit).

- [ ] **Task 6 (AC6)** — Unit tests for `tier-classify.js`
  - [ ] Create [tests/worker/engine/tier-classify.test.js](tests/worker/engine/tier-classify.test.js) with 10 test cases per AC6.
  - [ ] Reuse the `buildMockTx`-style pattern from [tests/integration/full-cycle.test.js:135-178](tests/integration/full-cycle.test.js#L135-L178) or [tests/worker/safety/anomaly-freeze.test.js](tests/worker/safety/anomaly-freeze.test.js).
  - [ ] **F1 atomicity assertion (test 2) is load-bearing**: verify the test FAILS if `tier` and `tier_cadence_minutes` are written via TWO separate UPDATE statements (simulate by mocking `applyTierClassification` to issue 2 UPDATEs; the test should reject). Optional: include a meta-assertion comment in the test file documenting this invariant.
  - [ ] Run `node --test tests/worker/engine/tier-classify.test.js` — all 10 tests pass.
  - [ ] Verify no `RESEND_API_KEY` env-stub is required (tier-classify.js has no transitive resend dependency); if surfacing during dev, apply pattern from memory `project_resend_env_stub_import_pattern`.

- [ ] **Task 7 (AC7)** — Final acceptance — Bundle C green-floor + full-suite verification
  - [ ] **Bundle C atomicity gate (non-negotiable)**: `node --test tests/integration/full-cycle.test.js tests/integration/pending-import-id-invariant.test.js tests/integration/circuit-breaker-trip.test.js` → ≥48 pass, 0 fail. If any flips red, story is not done.
  - [ ] Run `node --test tests/worker/engine/decide.test.js` → all Story 7.2 tests pass (verify STEP 1 + STEP 4 wire-up doesn't break the 12 fixture-driven decision tests).
  - [ ] Run `node --test tests/worker/engine/cooperative-absorb.test.js` → all Story 7.3 tests pass.
  - [ ] Run `node --test tests/worker/safety/circuit-breaker.test.js` → all Story 7.6 tests pass.
  - [ ] Run `node --test tests/worker/safety/anomaly-freeze.test.js` → all Story 7.4 tests pass.
  - [ ] Run `npm test` (full suite) — report total pass / total fail / list any newly-failing test files. Pre-existing pre-Go-Live fails (post-Story-7.9 baseline: ~23 unit fails) are out-of-scope but MUST NOT regress.
  - [ ] Run `npm run lint` — confirm no new lint errors on touched files.
  - [ ] Verify migration tree: `npx supabase migration list` shows no diff vs `main`.
  - [ ] Update File List in Dev Agent Record with every file edited.

---

## Dev Notes

### Story shape

This is a **feature story** that ships the engine-side tier-classification SSoT and closes the dispatcher-cadence-stays-at-15-min F1 race. Scope spans 2 production files + 1 new test file + 0 fixtures touched + 0 migrations. Net new SSoT module: `worker/src/engine/tier-classify.js`. The wire-up at decide.js STEP 1 + STEP 4 is small (~10 lines per call site) and follows the static-import + Pattern C discipline established by Story 7.4 + decide.js's own architectural rule at [decide.js:16-17](worker/src/engine/decide.js#L16-L17).

### Path I autocommit framing (SCP-2026-05-13 ratification — load-bearing)

Per [_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-13.md](_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-13.md): the cycle-assembly per-SKU loop runs in autocommit-per-statement mode, NOT inside an outer BEGIN/COMMIT. Story 7.5's "atomic T2a→T2b write per F1" wording MUST be read against this reality. The F1 atomicity invariant is satisfied by a SINGLE UPDATE statement writing BOTH `tier` AND `tier_cadence_minutes` — Postgres applies single-statement UPDATEs atomically. The separate `INSERT INTO audit_log` is a SEPARATE sequenced statement that autocommits at its own boundary. **DO NOT** introduce BEGIN/COMMIT framing in the spec, the module, or the tests. If a future story wraps cycle-assembly in real BEGIN/COMMIT per deferred-work.md line 466 option (a), this AC will be re-evaluated. Until then, sequenced autocommit is the locked semantic.

### SCP Amendment 4 — fixture `_expected` is sole oracle

The 3 fixtures this story binds (`p11-tier2a-recently-won-stays-watched.json`, `p11-tier3-no-competitors.json`, `p11-tier3-then-new-competitor.json`) MUST use `_expected` as the test oracle. NO hand-coded expectation tables in [tests/worker/engine/tier-classify.test.js](tests/worker/engine/tier-classify.test.js). The unit tests in this story are SYNTHETIC (no fixture-driven cases) because the 3 fixtures cover 3 of the 8 transition-table rows; the remaining 5 rows (T1→T2a, T2a→T2b F1, T2a-stays-T2a, {T2a,T2b}→T1, T3→T2a) are exercised via synthetic skuChannel constructs. Synthetic ≠ hand-coded fixture-oracle violation — the synthetic tests do NOT parallel any fixture's `_expected` block.

### Mirror SSoT pattern (with Pattern C deviation from Pattern A)

Mirror [shared/state/cron-state.js](shared/state/cron-state.js) for:
- Optimistic-concurrency `WHERE id=$N AND tier=$expectedFromTier` guard shape.
- Custom-error subclass pattern (Story 7.5 does NOT throw on race-loss — quiet return — but the JSDoc shape for the race-loss case mirrors `ConcurrentTransitionError`'s intent).
- Bundle B atomicity language: "module performs UPDATE in caller-supplied tx; audit emission happens in the same tx context in that order; no module-internal BEGIN/COMMIT".

**Pattern C deviation from Pattern A** (anomaly-freeze.js + cron-state.js Pattern A: module does UPDATE + writeAuditEvent inline; Story 7.5 Pattern C: module does UPDATE only, caller does writeAuditEvent):
- Rationale documented in AC1 Mechanism trace under "Why this is 'mirror cron-state.js / circuit-breaker.js / anomaly-freeze.js' in spirit, NOT in literal Pattern A".
- Functionally identical under Path I autocommit semantics: UPDATE then INSERT, both autocommit; failure-mode preserves ordering.
- Preserves decide.js's locked architectural rule at [decide.js:16-17](worker/src/engine/decide.js#L16-L17) (decide.js does NOT import writeAuditEvent).
- Preserves Bundle C green-floor `full-cycle.test.js` AC1 oracle ([L266-L271](tests/integration/full-cycle.test.js#L266-L271)) which asserts on `result.auditEvents.includes(...)` — Pattern C keeps tier-transition in the engine's `auditEvents` array.

### Bundle C atomicity guard

Story 7.5 is NOT a Bundle C participant — NOT in `bundle_dispatch_orders:` or `merge_blocks:` in sprint-status.yaml. It dispatches normally from `main` (post-Story-7.4 baseline). The Bundle C atomicity floor MUST stay green:
- [tests/integration/full-cycle.test.js](tests/integration/full-cycle.test.js) — floor expanded from 47 → 48 by Story 7.4 (new positive `'anomaly-freeze'` assertion). Story 7.5 does NOT add new test cases here; the 3 Story-7.5-bound fixtures already exist in the AC1 oracle loop. Goal: stay at ≥48/48.
- [tests/integration/pending-import-id-invariant.test.js](tests/integration/pending-import-id-invariant.test.js) — unchanged.
- [tests/integration/circuit-breaker-trip.test.js](tests/integration/circuit-breaker-trip.test.js) — unchanged.

### Architecture compliance (the 27 negative-assertion constraints)

This story touches the engine + adds a new internal module. Relevant constraints to verify clean:

- **Constraint #5** (no TypeScript) — pure JS + JSDoc.
- **Constraint #18** (no console.log) — pino only via `createWorkerLogger()`.
- **Constraint #19** (no direct `fetch` outside `shared/mirakl/`) — tier-classify.js makes zero HTTP calls.
- **Constraint #21** (no raw `INSERT INTO audit_log` outside `shared/audit/writer.js`) — Pattern C means tier-classify.js does NO audit emission. Constraint trivially satisfied.
- **Constraint #22** (no float-price math outside `shared/money/index.js`) — N/A.
- **Constraint #24** (no worker query missing `customer_marketplace_id` filter) — UPDATE filters by `sku_channels.id`, which is unique per-tenant via the FK chain. Matches anomaly-freeze.js + cron-state.js patterns (both ship with `WHERE id=$N` UPDATEs and pass the ESLint rule). NO `// safe: cross-customer cron` pragma required.

### Anti-patterns to avoid

- **DO NOT** add a new migration. Required `sku_channels` columns + `tier_value` enum exist in [supabase/migrations/202604301206_create_sku_channels.sql](supabase/migrations/202604301206_create_sku_channels.sql).
- **DO NOT** introduce literal BEGIN/COMMIT framing in the module or in the spec text. Path I autocommit is the locked semantic per SCP-2026-05-13.
- **DO NOT** import `writeAuditEvent` inside `tier-classify.js`. Pattern C — audit emission stays caller-side in cycle-assembly's existing emit loop. See AC1 Mechanism trace "Pattern C deviation" subsection.
- **DO NOT** add a `tier-transition-stable` or `tier-transition-no-op` event type. AD20 taxonomy is locked at 26 base + 2 Epic-12-additions = 28 max ([project-context.md](project-context.md) §AD20). The existing `TIER_TRANSITION` slug is reused for both real transitions AND the steady-state T3-stays-T3 case (fixture-driven per AC4 deviation flag).
- **DO NOT** flip any of the 3 Story-7.5-bound fixtures. SCP Amendment 4: fixtures are sealed; `_expected` is the sole oracle.
- **DO NOT** modify the asymmetric `expected.auditEvent !== null` guard at [full-cycle.test.js:266-271](tests/integration/full-cycle.test.js#L266-L271). The guard is intentional for fixtures with no audit-event expectation (e.g., the HOLD fixtures from Story 7.2 without explicit events). Preserved per Story 7.4 AC4 + SCP Amendment 4.
- **DO NOT** touch [worker/src/lib/tier-classify.js](worker/src/lib/tier-classify.js) (the Story 4.4 scan-time classifier). The two files have explicit boundary commentary at [lib/tier-classify.js:9-11](worker/src/lib/tier-classify.js#L9-L11) — they are NOT the same module. Story 4.4's `classifyInitialTier` runs at onboarding scan; Story 7.5's `applyTierClassification` runs every engine cycle.
- **DO NOT** call `applyTierClassification` outside `worker/src/engine/decide.js` in this story. Story 7.7 (reconciliation.js) will be the second authorized caller — but that's a different story. If a future caller surfaces during dev, surface to Pedro first.
- **DO NOT** restructure decide.js's STEP 2 (cooperative-absorb dynamic import) or STEP 5 (CB dynamic import). Those bridges remain.
- **DO NOT** use OF24. Constraint #6 + AD7 — `pri01-writer.js` is the only price-write path. Tier transitions don't push prices to Mirakl.
- **DO NOT** epic-spec-correct the AC#4 wording divergence ("no audit event for steady-state" vs fixture `_expected.auditEvent='tier-transition'`). Flag in Dev Agent Record; defer to Epic 7 retro for resolution. Fixture wins per SCP Amendment 4.

### Project Structure Notes

Files touched (anticipated):

| File | Change | AC | New? |
|---|---|---|---|
| [worker/src/engine/tier-classify.js](worker/src/engine/tier-classify.js) | New SSoT module: `applyTierClassification` | AC1 | NEW |
| [worker/src/engine/decide.js](worker/src/engine/decide.js) | Add static import + STEP 1 `applyTierClassification` call + STEP 4 `applyTierClassification` call + comment update | AC2 | Edit |
| [tests/worker/engine/tier-classify.test.js](tests/worker/engine/tier-classify.test.js) | New unit-test file: 9 test cases (synthetic skuChannel, no fixture-driven) | AC6 | NEW |
| [tests/integration/full-cycle.test.js](tests/integration/full-cycle.test.js) | (Maybe) extend `buildMockSkuChannel` to handle `<set in test: ...>` sentinel for `last_won_at`; verify oracle loop passes for 3 Story-7.5 fixtures | AC3 | Maybe edit |

**SSoT-table divergence flag (carry-over from Story 7.4):** [project-context.md](project-context.md) §SSoT Modules row 7 still lists `shared/state/sku-freeze.js` for the freezeSkuForReview SSoT (already flagged divergent in Story 7.4 spec; the architecture distillate + shipped code agree on `worker/src/safety/anomaly-freeze.js`). Story 7.5 does NOT touch this row. No additional divergence introduced by this story (engine tier-classify.js path matches architecture distillate [05-directory-tree.md:123](_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md#L123) — confirmed during shard).

### Testing Standards

- Test runner: `node --test` (Constraint #2 — no Jest/Vitest).
- Mocking: `buildMockTx` pattern from [tests/integration/full-cycle.test.js:135-178](tests/integration/full-cycle.test.js#L135-L178) or sibling Story 7.4 anomaly-freeze test; no new mocking libraries.
- Synthetic skuChannel construction: inline object literals matching the schema in [supabase/migrations/202604301206_create_sku_channels.sql:3-43](supabase/migrations/202604301206_create_sku_channels.sql#L3-L43). NO `buildMockSkuChannel` reuse in the unit test (that helper is for fixture-driven integration tests with `_fixture_meta` overrides).
- `integration_test_required: false` for this story — no new pg/Supabase Auth/Mirakl/Stripe SDK surface. The tier-transition writes touch `sku_channels` UPDATEs which are already exercised by Bundle C's `full-cycle.test.js` via the 3 fixtures; no new Phase 4.5 gate trigger needed.

### Library Empirical Contracts (load-bearing)

- **#1 GoTrue HINT-code stripping** — not applicable (no signup flow).
- **#2 `@fastify/cookie` v11+ signed-cookie unwrap** — not applicable (no HTTP routes).
- **#3 pg Pool CA pinning** — not applicable (uses caller-supplied `tx`, no direct `pg.Pool` instantiation).
- **#14 `no-direct-fetch` ESLint comment-scan** — not applicable (no HTTP calls).
- Memory `project_resend_env_stub_import_pattern` — verify during Task 6 that tier-classify.js has NO transitive resend dependency; if surfacing, apply env-stub + `await import` pattern.

### Previous Story Intelligence

- **Story 7.4 (anomaly-freeze.js, PR #94 merged 2026-05-13 squash `b7ab679`, done 2026-05-13)**: shipped `worker/src/safety/anomaly-freeze.js` as the AD12 SSoT + accept/reject endpoints + fixture flip + RLS tests + unit tests. Pattern A (UPDATE + writeAuditEvent inline) was the right shape for AD12 because anomaly-freeze.js is called from `cooperative-absorb.js` (not decide.js directly) and there's no equivalent "engine returns auditEvents" rule for that call site. Story 7.5 uses Pattern C (UPDATE only; caller emits) because decide.js's `auditEvents`-return rule is the existing architecture invariant at [decide.js:16-17](worker/src/engine/decide.js#L16-L17). The two patterns are autocommit-equivalent per SCP-2026-05-13 Path I.
- **Story 7.6 (circuit-breaker.js, PR #89 → PR #91 mega-merge `89b2378`, done 2026-05-13)**: shipped per-SKU + per-cycle CB. Per-SKU CB uses Pattern C (pure check; cycle-assembly emits the audit row at [cycle-assembly.js:154-167](worker/src/cycle-assembly.js#L154-L167)). Story 7.5's Pattern C is the same shape (caller-side emission). Story 7.6 also confirmed the inline-`sendCriticalAlert` precedent for Path I autocommit (later ratified by SCP-2026-05-13 for Story 7.4 AC1).
- **Story 7.3 (cooperative-absorb.js, PR #88 → PR #91 mega-merge, done 2026-05-13)**: shipped absorption logic. Story 7.5 does NOT touch cooperative-absorb.js. STEP 2 stub-fallback in decide.js was dismantled by Story 7.4 AC2; Story 7.5 preserves that dismantle (decide.js STEP 2 already does dynamic import without fallback).
- **Story 7.2 (decide.js, PR #87 → PR #91 mega-merge, done 2026-05-13)**: shipped `decideForSkuChannel`. Story 7.5 modifies decide.js minimally (STEP 1 + STEP 4 wire-up). The existing 12 fixture-driven tests in `decide.test.js` MUST continue to pass after Story 7.5's wire-up; verify in Task 7.
- **Story 4.4 (scan-time classifier, `worker/src/lib/tier-classify.js`, done 2026-05-07)**: shipped the initial-tier classifier that runs ONCE at onboarding scan. Story 7.5 ships the engine-cycle classifier at `worker/src/engine/tier-classify.js`. The two files are explicitly named to distinguish purpose ([lib/tier-classify.js:9-11](worker/src/lib/tier-classify.js#L9-L11) inline NOTE block).
- **Story 9.0 (audit writer, done 2026-05-04)**: shipped `shared/audit/writer.js` `writeAuditEvent` SSoT + `no-raw-INSERT-audit-log` ESLint rule. Story 7.5 does NOT import this directly — Pattern C delegates emission to cycle-assembly which already imports it.
- **SCP-2026-05-13 (Path I autocommit ratification, 2026-05-13)**: the load-bearing input for Story 7.5's mechanism framing. See AC1 Mechanism trace + Path I autocommit framing dev-note section.
- **Bundle C close-out retro (2026-05-13)**: §12 Session 3 ordering (7.4 → 7.5 → 7.7) is the dispatch sequence. 7.5 fires AFTER 7.4 lands (already merged via PR #94) and BEFORE 7.7 (Story 7.7 reconciliation.js depends on Story 7.5's applyTierClassification per Bob-trace 2026-05-13).
- **3rd-sighting mechanism-trace pattern (deferred-work.md line 467)**: Story 6.3 wire-up + Story 7.8 fake-gate + Story 7.4 AC1 mechanism — pattern is now 3 sightings within Epic 7. Story 7.5 spec applies the AC1 mechanism-trace discipline at sharding time per Pedro's brief 2026-05-13: trace the proposed mechanism through the codebase BEFORE writing the AC, cite file:line evidence, document tx topology + statement ordering. This is the discipline that fills the future "MECHANISM" section of the sharded-story template (deferred-work.md line 467 recommendation (b)).

### Git intelligence

- Branch: dispatches normally from `main` (NOT from any bundle branch).
- Worktree fork point: `main` HEAD at session start. Recent commits relevant to context:
  - `06269df` Set story 7.4 to done in sprint-status (post-merge reconciliation)
  - `8619594` Record deferred findings from PR #94 review
  - `b7ab679` story-7.4: anomaly-freeze SSoT + accept/reject endpoints (#94)
  - `05ec208` chore(correct-course): Story 7.4 AC1 spec amendment — align with autocommit production semantics (Story 7.6 precedent)
- Expected file count in PR: 3 (the 1 new module + 1 edited decide.js + 1 new test file). Optional: 1 more edited file if `buildMockSkuChannel` needs the `<set in test: ...>` sentinel handler.
- No `bundle_dispatch_orders` constraint: this story is NOT part of any atomicity bundle and dispatches in isolation.
- Q8 Phase 1 CI gate (`node --test tests/integration/{full-cycle,pending-import-id-invariant,circuit-breaker-trip}.test.js`, narrowed scope per [.github/workflows/ci.yml](.github/workflows/ci.yml) post-1501c72) is the safety floor — Bundle C ≥48/48 must stay green on the PR.

### References

- **Retro source-of-truth (§12 Session 3 ordering + 3-sighting pattern):** [_bmad-output/implementation-artifacts/bundle-c-close-out-retro-2026-05-13.md](_bmad-output/implementation-artifacts/bundle-c-close-out-retro-2026-05-13.md) §12 Session 3
- **SCP ratifying Path I autocommit semantics:** [_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-13.md](_bmad-output/planning-artifacts/sprint-change-proposal-2026-05-13.md) §1-3
- **Deferred-work entry tracking the 3-sighting pattern:** [_bmad-output/implementation-artifacts/deferred-work.md:467](_bmad-output/implementation-artifacts/deferred-work.md#L467) (3rd-sighting "spec-outcome-without-mechanism")
- **Epic spec:** [_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md#L122-L137](_bmad-output/planning-artifacts/epics-distillate/04-epic-7-engine-safety.md#L122-L137) Story 7.5 (AC#1-AC#6)
- **AD10 (4-state tier system) + F1 amendment:** [_bmad-output/planning-artifacts/architecture-distillate/_index.md](_bmad-output/planning-artifacts/architecture-distillate/_index.md) Cross-Cutting Pre-Locked Decisions C + Tier 2b cadence section
- **Production modules to reference / consume:**
  - [worker/src/engine/decide.js](worker/src/engine/decide.js) (STEP 1 + STEP 4 wire-up points)
  - [worker/src/safety/anomaly-freeze.js](worker/src/safety/anomaly-freeze.js) (Story 7.4 SSoT — Pattern A reference; mirror Bundle B atomicity language but deviate to Pattern C per AC1 Mechanism trace rationale)
  - [worker/src/safety/circuit-breaker.js](worker/src/safety/circuit-breaker.js) (Story 7.6 — Pattern C reference for per-SKU CB shape)
  - [shared/state/cron-state.js](shared/state/cron-state.js) (Pattern A reference for optimistic-concurrency `WHERE id=$N AND tier=$expectedFromTier` guard shape)
  - [worker/src/cycle-assembly.js](worker/src/cycle-assembly.js) (audit emission loop at [L199-L211](worker/src/cycle-assembly.js#L199-L211) — Pattern C consumer)
  - [worker/src/lib/tier-classify.js](worker/src/lib/tier-classify.js) (Story 4.4 scan-time classifier — DIFFERENT file, DO NOT touch; reference for naming-distinction comment style)
  - [shared/audit/event-types.js:78](shared/audit/event-types.js#L78) (`EVENT_TYPES.TIER_TRANSITION`) + [L260-L264](shared/audit/event-types.js#L260-L264) (`PayloadForTierTransition` typedef)
- **Migrations (existing — no new ones in this story):**
  - [supabase/migrations/202604301206_create_sku_channels.sql:1](supabase/migrations/202604301206_create_sku_channels.sql#L1) (`tier_value` enum: `'1' | '2a' | '2b' | '3'`)
  - [supabase/migrations/202604301206_create_sku_channels.sql:17-21](supabase/migrations/202604301206_create_sku_channels.sql#L17-L21) (`tier`, `tier_cadence_minutes`, `last_won_at` columns)
- **Test files to extend (maybe):**
  - [tests/integration/full-cycle.test.js](tests/integration/full-cycle.test.js) (only if `buildMockSkuChannel` needs `<set in test: ...>` sentinel handler — verify first)
- **Test files to create:**
  - [tests/worker/engine/tier-classify.test.js](tests/worker/engine/tier-classify.test.js) (AC6 — 9 synthetic-skuChannel test cases)
- **Fixtures to consume (sealed — not modified):**
  - [tests/fixtures/p11/p11-tier2a-recently-won-stays-watched.json](tests/fixtures/p11/p11-tier2a-recently-won-stays-watched.json) (AC3)
  - [tests/fixtures/p11/p11-tier3-no-competitors.json](tests/fixtures/p11/p11-tier3-no-competitors.json) (AC4)
  - [tests/fixtures/p11/p11-tier3-then-new-competitor.json](tests/fixtures/p11/p11-tier3-then-new-competitor.json) (AC5)
- **Distillates:**
  - [_bmad-output/planning-artifacts/architecture-distillate/_index.md](_bmad-output/planning-artifacts/architecture-distillate/_index.md) — 27 constraints, AD10, AD20, Cross-Cutting Pre-Locked Decisions C (Tier 2b cadence = 45 min)
  - [_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md](_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md) — 11 SSoT modules, atomicity rules
  - [_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md:123](_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md#L123) (target path `worker/src/engine/tier-classify.js`) + [L261](_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md#L261) (test path)
  - [_bmad-output/planning-artifacts/epics-distillate/_index.md](_bmad-output/planning-artifacts/epics-distillate/_index.md) — Cross-cutting 17 P11 fixtures (Story 7.5 binds 3), 6 ESLint rules
- **Project context:** [project-context.md](project-context.md) §27 Constraints (#5, #18, #19, #21, #22, #24) + §11 SSoT Modules + §AD20 28-Event Audit Taxonomy + §Library Empirical Contracts
- **Memory entries consulted:**
  - `feedback_trace_proposed_fixes` (3-sighting mechanism-trace pattern — load-bearing for AC1 Mechanism trace section)
  - `feedback_correct_course_validated_for_spec_failures` (Bob owns spec-mechanism recovery; not applicable in this forward-looking shard)
  - `feedback_bmad_sm_owns_spec_failures` (SM ownership of spec-driven recovery — informs the Anti-pattern of NOT epic-spec-correcting the AC#4 wording divergence inline)
  - `feedback_no_premature_abstraction` (keep `applyTierClassification` narrowly scoped to AD10 — no generic "tier-state machine" abstraction; the 4 states + 8 transitions fit in one function)
  - `feedback_step5_import_path_boot_check` (run `node --check` after Task 1 + Task 2 edits)
  - `feedback_grep_drift_widely` (after Task 2 edits, grep `"Story 7.5 handles tier column DB writes"` across repo — should return 0 matches; also grep `engine/tier-classify` to verify only the new module + decide.js import reference it)
  - `project_resend_env_stub_import_pattern` (NOT load-bearing here — verify tier-classify.js has no transitive resend dependency; if it acquires one during dev, apply the pattern)
  - `feedback_bad_subagents_handle_missing_slash_commands` (BAD dispatch tolerance — not load-bearing here)

### Out-of-scope items (explicitly NOT in this story)

- Story 7.7 reconciliation.js + applyTierClassification re-use from the cron-side caller (depends on Story 7.5; ships AFTER per retro §12 Session 3 ordering).
- Epic-spec AC#4 wording correction ("no audit event for steady-state" vs fixture `_expected.auditEvent='tier-transition'`). Flag in Dev Agent Record; defer to Epic 7 retro for resolution.
- The `PayloadForTierTransition` typedef shape correctness (cycle-assembly currently emits with `payload: { action, newPriceCents }` which doesn't match `{ fromTier, toTier, reason }`). Pre-existing on `main`; Story 7.5 does NOT regress it. Future story or Epic 7 retro should align.
- New event types (`tier-transition-stable`, `tier-promote`, etc.) — AD20 taxonomy locked at 28 entries.
- Bundle B real-BEGIN/COMMIT wrap for cycle-assembly's per-SKU loop (deferred-work.md line 466 option (a)) — explicit Epic 7 retro deferral.
- `worker/src/lib/tier-classify.js` (Story 4.4 scan-time classifier) — different file, different purpose, DO NOT touch.
- The 14 non-Story-7.5 fixtures — unchanged.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Step 3 developer, 2026-05-13+)

### Debug Log References

### Completion Notes List

### File List

### Review Findings

Code review 2026-05-13 — Step 5 (Opus, critical-path gate). All key invariants verified clean:

- F1 atomic dual-column write — single UPDATE statement writes both `tier` AND `tier_cadence_minutes` in one SET clause; verified by load-bearing unit-test assertion (`tests/worker/engine/tier-classify.test.js` test 2 — `countSkuChannelUpdates(...) === 1`). ✅
- Path I autocommit-per-statement preserved — no BEGIN/COMMIT framing introduced; UPDATE autocommits then cycle-assembly's loop emits the audit INSERT separately. ✅
- Pattern C invariant — `tier-classify.js` does NOT import `writeAuditEvent` (source-inspection negative test asserts); `decide.js:17-18` architectural comment preserved verbatim. ✅
- Optimistic-concurrency `WHERE id=$N AND tier=$expectedFromTier` race-guard present on every UPDATE; rowCount=0 returns quiet `'concurrent-transition-detected'` without throw — mirrors `cron-state.js:132-137`. ✅
- Constraint #19 (no direct fetch outside `shared/mirakl/`) — verified; module makes no HTTP calls. ✅
- Bundle C floor: 47/47 pass (no regression vs main baseline of 47/47; spec's stated "≥48" floor is a pre-existing spec-vs-baseline drift — see Defer item below). ✅
- Boot tests: `node --check worker/src/engine/tier-classify.js` + `node --check worker/src/engine/decide.js` both clean (per `feedback_step5_import_path_boot_check`). ✅
- Lint clean on touched files (no `no-default-export`, `no-console`, `worker-must-filter-by-customer` violations). ✅
- 18 unit tests pass for `tier-classify.test.js` (10 AC6 transitions + 5 source-inspection + 3 sub-cases for {T1,T2a,T2b}→T3). ✅

- [x] [Review][Defer] Spec AC7 §2 Bundle C floor states ≥48 pass, but actual `main` baseline is 47/47 — deferred, pre-existing spec-vs-baseline drift; not a Story 7.5 regression (47→47).
- [x] [Review][Defer] `tests/worker/engine/decide.test.js` has 1 pre-existing failure (`position_1_with_2nd_but_ceiling_prevents_raise_returns_hold` — expected HOLD, actual CEILING_RAISE) [tests/worker/engine/decide.test.js] — deferred, confirmed pre-existing on `main`; out-of-scope per spec AC7 §6 (pre-existing fail baseline tolerated).

