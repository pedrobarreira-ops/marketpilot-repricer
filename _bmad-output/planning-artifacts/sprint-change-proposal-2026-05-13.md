# Sprint Change Proposal — 2026-05-13

**Trigger:** Story 7.4 (PR #94) — /bad-review Subagent A surfaced spec-vs-implementation gap on AC1 line 39 ("AFTER the transaction commits"). Investigation revealed the spec was framed under a transaction model that does not exist in current production code.
**Triggering story:** [7-4-worker-src-safety-anomaly-freeze-js-audit-anomaly-sku-accept-reject-endpoints.md](../implementation-artifacts/7-4-worker-src-safety-anomaly-freeze-js-audit-anomaly-sku-accept-reject-endpoints.md)
**Issue type:** Misunderstanding of original requirements (spec wording assumed an outer cycle-level BEGIN/COMMIT around `assembleCycle`; production runs in autocommit at the per-SKU level).
**Scope classification:** Minor — single-AC spec text amendment + deferred-work entry. No epic-scope, PRD-scope, or code changes. PR #94 implementation stands as-is.
**Author:** Bob (SM), Path I locked by Pedro 2026-05-13.

---

## Section 1 — Issue Summary

PR #94 ships [worker/src/safety/anomaly-freeze.js](worker/src/safety/anomaly-freeze.js) per Story 7.4 AC1. /bad-review (top-level audit, 2026-05-13) Subagent A surfaced:

> Spec AC1 line 39 mandates: *"AFTER the transaction commits (NOT inside `tx`), calls `sendCriticalAlert(...)`".*
>
> Implementation at [worker/src/safety/anomaly-freeze.js:162-174](worker/src/safety/anomaly-freeze.js#L162-L174) fires `sendCriticalAlert` INSIDE the caller-supplied `tx` — direct contradiction with spec outcome.

This was flagged as a 3rd-sighting "spec-outcome-without-mechanism" pattern (after Story 6.3 wire-up gap + Story 7.8 fake-gate). Initial proposed remedy was Option B: have `freezeSkuForReview` return an `alertContext` for caller-side propagation up to the cycle-tx commit boundary in `master-cron.js` / `cycle-assembly.js`.

**Investigation finding (Bob, 2026-05-13):** There is no cycle-level transaction in current production code. The premise of Option B does not hold.

Evidence traced from master-cron → dispatcher → cycle-assembly:

| Layer | File | Tx behavior |
|---|---|---|
| Cron tick | [worker/src/jobs/master-cron.js:38-55](worker/src/jobs/master-cron.js#L38-L55) | Calls `dispatchCycle({ pool })`. Owns no tx. |
| Dispatcher loop | [worker/src/dispatcher.js:200-264](worker/src/dispatcher.js#L200-L264) | `client = await pool.connect()` per customer, advisory lock, then `await assembleCycle(client, ...)` at [L243](worker/src/dispatcher.js#L243). **No BEGIN/COMMIT wraps the assembleCycle call.** Only BEGIN/COMMITs in the file are micro-tx around the cycle-start/cycle-end audit events ([L136-L144](worker/src/dispatcher.js#L136-L144)). |
| Cycle-assembly | [worker/src/cycle-assembly.js:106-217](worker/src/cycle-assembly.js#L106-L217) | Per-SKU loop calls `await tx.query(...)` directly with no BEGIN. Each query is its own implicit autocommit tx. |

**Story 7.6 precedent (already merged):** [worker/src/cycle-assembly.js:155-180](worker/src/cycle-assembly.js#L155-L180) for the per-SKU circuit-breaker trip path does `writeAuditEvent` then `sendCriticalAlert` immediately after in the same execution context with the same autocommit-`tx`. Shipped, code-reviewed, accepted. PR #94's anomaly-freeze.js applied the same shape.

**Root cause:** Spec AC1 line 39 was framed in the language of an outer BEGIN/COMMIT ("AFTER the transaction commits") that does not exist in this codebase. In current autocommit production semantics, the `await tx.query(UPDATE)` and `await writeAuditEvent(...)` calls each commit at statement boundary; sending the alert immediately after both awaits resolve **is** post-commit — just per-statement commits, not per-cycle.

The dev's miss is therefore a spec-mechanism gap reading literally against a tx topology that doesn't exist, NOT an outcome regression.

---

## Section 2 — Impact Analysis

**Epic impact (Epic 7):** None. Epic stays as planned.

**Story impact:**
- Story 7.4 — AC1 line 39 wording amended (this proposal). AC2 / AC3 / AC4 / AC5 / AC6 / AC7 / AC8 unchanged. PR #94 implementation stands as-is.
- Story 7.6 (already shipped) — pattern retroactively legitimized by this amendment's framing.
- No other story specs touched.

**Artifact conflicts:**
- PRD — no conflict. No FR/NFR changes.
- Architecture — no conflict. AD12 (per-SKU anomaly freeze) + AD20 (audit taxonomy) + AD25 (best-effort Resend) unchanged. The latent question — whether cycle-assembly's per-SKU loop should be wrapped in a real BEGIN/COMMIT for true Bundle B atomicity — is logged as deferred-work, not amended here.
- UX — N/A.
- Epics distillate — no conflict.
- `sprint-status.yaml` — no status change; Story 7.4 stays `review` pending PR #94 merge.
- `project-context.md` — no change. Bundle B framing ("state mutation + audit emission must be in ONE caller-owned tx") remains the architectural target; deferred-work captures the current-state gap.

**Technical impact:**
- One spec file edit (~6 lines).
- One deferred-work.md entry under a new "PR #94 review" section.
- Single chore commit on `main`.
- PR #94 branch unaffected; merges as-is once /bad-review's other findings are addressed (Findings 2+3, ratified separately per Pedro's note).

---

## Section 3 — Recommended Approach

**Path I — Ratify the implementation, amend AC1 wording to match production tx semantics, log the future-state revisit as deferred-work.**

Rationale (Pedro + Bob aligned 2026-05-13):

1. The "outer tx rolls back → false-positive alert" failure mode requires a tx topology that does not exist in current production code. It cannot manifest today.
2. The dev's implementation matches Story 7.6's already-shipped pattern. Forcing Story 7.4 to a different shape would introduce inconsistency without functional benefit.
3. Option B's alertContext propagation (~80+ lines of plumbing across `freezeSkuForReview` → `cooperative-absorb` → `decide.js` → cycle-assembly + new AC9 for the caller-side commit hook) would ship zero behavior change in autocommit mode. The plumbing only becomes meaningful once cycle-assembly is wrapped in a real BEGIN/COMMIT — and that wrapping is not in scope for Story 7.4 or any near-term story.
4. The right place to address the broader Bundle B autocommit-vs-BEGIN/COMMIT question is an Epic 7 retro discussion (or a dedicated Bundle B hardening story if retro elevates it). It touches every cycle-assembly-routed `writeAuditEvent` call site, not just Story 7.4.

Effort: Minor — spec wording + deferred-work entry. Risk: Low. Timeline impact: none — unblocks PR #94 immediately.

---

## Section 4 — Detailed Change Proposals

### Amendment 1 — Story 7.4 AC1 line 39 (single substantive change)

**File:** [_bmad-output/implementation-artifacts/7-4-worker-src-safety-anomaly-freeze-js-audit-anomaly-sku-accept-reject-endpoints.md](../implementation-artifacts/7-4-worker-src-safety-anomaly-freeze-js-audit-anomaly-sku-accept-reject-endpoints.md)

**Section:** AC1 — Ship `worker/src/safety/anomaly-freeze.js` as the AD12 SSoT module → 5th bullet of the `freezeSkuForReview` contract (line 39).

**OLD:**
```
- AFTER the transaction commits (NOT inside `tx`), calls `sendCriticalAlert({ to: customerEmail, subject, html })` from [shared/resend/client.js:59](shared/resend/client.js#L59). Resend errors are caught + logged by `sendCriticalAlert` itself (best-effort per AD25); freeze success is not gated on email delivery. Critical alert delivery target ≤5 min per NFR-P9.
```

**NEW:**
```
- Calls `sendCriticalAlert({ to: customerEmail, subject, html })` from [shared/resend/client.js:59](shared/resend/client.js#L59) AFTER both DB awaits resolve (the `UPDATE sku_channels` and the `writeAuditEvent` INSERT). In current production semantics, cycle-assembly runs in autocommit mode at the per-SKU level — each `await tx.query(...)` autocommits at statement boundary, so the alert is necessarily post-persistence. Sending the alert inline within `freezeSkuForReview` is the locked pattern per Story 7.6 precedent ([worker/src/cycle-assembly.js:155-180](worker/src/cycle-assembly.js#L155-L180), `circuit-breaker-per-sku-trip` emission). Resend errors are caught + logged by `sendCriticalAlert` itself (best-effort per AD25); freeze success is not gated on email delivery. Critical alert delivery target ≤5 min per NFR-P9. **Future-state revisit:** when/if cycle-assembly is later wrapped in a real BEGIN/COMMIT for true Bundle B atomicity, this AC must be re-evaluated to propagate `alertContext` upward to the cycle-tx boundary (logged in [deferred-work.md](deferred-work.md) under "PR #94 review").
```

**Rationale:** Aligns the spec with the autocommit tx model actually shipped (no outer BEGIN/COMMIT around `assembleCycle`'s per-SKU loop) and with the Story 7.6 precedent the dev followed. Preserves the architectural intent (alert fires after persistence) while removing the unsatisfiable "AFTER `tx.commit()`" wording. The future-state revisit is captured in deferred-work, not buried in spec text.

---

### Amendment 2 — Deferred-work.md entry under new "PR #94 review" section

**File:** [_bmad-output/implementation-artifacts/deferred-work.md](../implementation-artifacts/deferred-work.md)

**Section:** Append new H2 section after the existing PR #93 review block (line 446-451).

**ADD:**
```markdown
---

## Deferred from: PR #94 review (2026-05-13)

- **Bundle B real-BEGIN/COMMIT atomicity for cycle-assembly per-SKU loop — autocommit-vs-BEGIN/COMMIT semantics revisit** [`worker/src/cycle-assembly.js:106-217` per-SKU loop + `worker/src/dispatcher.js:200-264` per-customer client + `shared/audit/writer.js` "MUST be active tx" guard semantics + `shared/state/cron-state.js` Bundle B invariant docstring] — Surfaced during Story 7.4 /bad-review (2026-05-13) Subagent A finding on AC1 line 39 wording. Bundle B atomicity invariant per [project-context.md](../../project-context.md#L154) requires "state mutation + audit emission in ONE caller-owned tx" — but cycle-assembly's per-SKU loop currently calls `await tx.query(...)` and `await writeAuditEvent(...)` in autocommit mode (no explicit BEGIN/COMMIT wraps the `assembleCycle` call from dispatcher.js:243; the only BEGIN/COMMITs are micro-tx around cycle-start/cycle-end audit events at dispatcher.js:136-144). Each statement therefore autocommits at its own boundary; "single transaction" is currently aspirational for every writeAuditEvent call routed through cycle-assembly. Affects Stories 5.2, 7.2, 7.6 (already shipped) and 7.4 (PR #94 in-flight). Currently the failure mode (outer tx rolls back → audit row INSERTed but state UPDATE rolled back → false-positive alert / inconsistent persistence) cannot manifest because there is no outer tx to roll back. SCP-2026-05-13 (Path I) ratified the autocommit pattern for Story 7.4 AC1 per Story 7.6 precedent and amended the spec wording accordingly. **Future-state revisit paths to evaluate in Epic 7 retro: (a)** Wrap cycle-assembly's per-SKU loop in explicit BEGIN/COMMIT (per-SKU tx) so writeAuditEvent's "MUST be active tx" guard is satisfied with a real tx and Bundle B atomicity holds end-to-end. Touches Stories 5.2, 7.2, 7.6, 7.4 + adds `alertContext` propagation to caller for any inline `sendCriticalAlert` site (today: 7.4 anomaly-freeze + 7.6 per-SKU CB trip). **(b)** Accept autocommit as the architectural baseline; downgrade Bundle B atomicity language in project-context.md §3 from "single transaction" to "sequenced autocommits with post-persistence side effects" to match reality. Recommendation: defer to Epic 7 retro; option (a) is cleaner if the cost is bounded (~1-2 stories worth of plumbing across the 4 affected stories + alertContext propagation), but option (b) is honest and matches the shipped reality. **Re-evaluate Story 7.4 AC1 line 39 and Story 7.6 per-SKU CB trip alert-emission site if option (a) is chosen.**
- **/bad-review Subagent A correctly flagged spec-vs-implementation gap; resolution is spec amendment, not code change (3rd-sighting "spec-outcome-without-mechanism" pattern — Story 6.3 wire-up, Story 7.8 fake-gate, Story 7.4 AC1 mechanism gap)** [`.claude/skills/bmad-create-story/` + spec authoring patterns] — Pattern is now 3 sightings within Epic 7. Common shape: spec describes a desired OUTCOME (alert fires post-commit, decide.js dispatches PRI03 parser, gate test exercises real production code) but is silent or wrong on the MECHANISM by which that outcome is achieved. Dev follows the literal mechanism that doesn't exist, OR rationalizes a divergence to meet the outcome, and the gap surfaces at review. For Story 7.4 specifically, the mechanism gap was "AFTER the transaction commits" written under the assumption of an outer BEGIN/COMMIT that does not exist. Bob owns recovery via `/bmad-correct-course` per `feedback_bmad_sm_owns_spec_failures.md`. **Pattern-level fix paths to evaluate in Epic 7 retro: (a)** Sharding-time mechanism trace — when sharding a story, Bob explicitly traces the proposed mechanism through the codebase (e.g., "does this `tx` come from BEGIN/COMMIT or autocommit?", "where does the call chain originate?", "what's the commit boundary?") and cites concrete file:line evidence in Dev Notes. Adds ~5-10 min per story but catches mechanism gaps before dev fires. **(b)** Make MECHANISM a first-class Dev Notes section in the sharded story template alongside Architecture compliance / Bundle awareness / Library Empirical Contracts. Forces the trace as a structural requirement. Recommendation: (b), with (a) as the discipline that fills the section.

---
```

**Rationale:** Records the latent architectural question (autocommit vs BEGIN/COMMIT) without amending architecture distillate (whose Bundle B framing remains the target). Captures the 3rd-sighting pattern for Epic 7 retro promotion per Pedro's optional memory-addition note. New entries follow the existing deferred-work structure (H2 section per PR, bulleted entries with file pointers, recommendation + retro paths).

---

## Section 5 — Implementation Handoff

**Scope classification:** Minor.

**Routing:** Bob executes the changes directly. No dev hand-off needed.

**Deliverables (single commit on main):**

1. Edit AC1 line 39 in [_bmad-output/implementation-artifacts/7-4-worker-src-safety-anomaly-freeze-js-audit-anomaly-sku-accept-reject-endpoints.md](../implementation-artifacts/7-4-worker-src-safety-anomaly-freeze-js-audit-anomaly-sku-accept-reject-endpoints.md) per Amendment 1.
2. Append "Deferred from: PR #94 review (2026-05-13)" section to [_bmad-output/implementation-artifacts/deferred-work.md](../implementation-artifacts/deferred-work.md) per Amendment 2.
3. Write this SCP doc.
4. Single commit: `chore(correct-course): Story 7.4 AC1 spec amendment — align with autocommit production semantics (Story 7.6 precedent)`.

**PR #94 branch:** unaffected. Pedro pulls the amended spec onto the branch (git fetch + rebase or merge main) before BAD/dev re-pass closes /bad-review Findings 2+3.

**Success criteria:**
- AC1 line 39 reads against current production tx semantics.
- /bad-review Subagent A's Finding 1 (the mechanism-gap finding) is resolvable by spec ratification, not code change.
- Findings 2+3 from /bad-review are addressed separately (out of scope for this SCP — Pedro ratifies them via the standard /bad re-dev or focused dev pass).
- Bundle B autocommit-vs-BEGIN/COMMIT question is captured for Epic 7 retro, not silently dropped.
