# Story 9.0: `writeAuditEvent` SSoT Module + `audit_log_event_types` Lookup Table + 26-Row AD20 Taxonomy Seed

**Sprint-status key:** `9-0-writeauditevent-ssot-module-audit-log-event-types-lookup-table-26-row-ad20-taxonomy-seed`
**Status:** ready-for-dev
**Size:** M
**Calendar position:** CALENDAR-EARLY — Story 1.x sibling; ships BEFORE Epic 3 and BEFORE Epic 5's dispatcher (Story 5.1 imports `writeAuditEvent`).

---

## Narrative

**As a** BAD subagent implementing any story that emits audit events (Stories 4.1, 5.1, 6.x, 7.x, 10.x, 11.x, 12.x),
**I want** a single-source-of-truth `writeAuditEvent` module backed by a seeded `audit_log_event_types` lookup table,
**So that** every audit event emission in the codebase flows through one controlled path — enforcing structured payloads, priority derivation, and type safety — with an ESLint rule preventing any accidental raw `INSERT INTO audit_log` bypass.

---

## Trace

- **Architecture decisions:** AD20 (taxonomy + lookup table + writer SSoT), F5 (migration ordering: `audit_log_event_types` MUST run before `audit_log` partitioned table in Story 9.1)
- **Functional requirements:** FR38d (event-type taxonomy at three priority levels)
- **Non-functional requirements:** NFR-S6 (append-only at app layer)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/06-epics-9-10-audit-deletion.md`, Story 9.0

---

## SSoT Modules Introduced

This story establishes two of the 11 architecture-mandated single-source-of-truth modules:

1. **`shared/audit/writer.js`** — exports `writeAuditEvent({ tx, customerMarketplaceId, skuId, skuChannelId, eventType, cycleId, payload })` — the ONLY permitted path to INSERT into `audit_log`. All callers in every epic must use this function. Never call raw `INSERT INTO audit_log` anywhere else (ESLint rule enforces this).

2. **`shared/audit/event-types.js`** — exports `EVENT_TYPES` constant (object literal mirroring all 26 seeded rows) and JSDoc `@typedef PayloadFor<EventType>` for every event type's structured payload shape.

These join the SSoT module registry in `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md`.

**ESLint rule shipped with this story:** `eslint-rules/no-raw-INSERT-audit-log.js`

---

## Mirakl MCP Verification

**N/A** — Story 9.0 does not call any Mirakl endpoint. No Mirakl MCP verification step required or applicable.

---

## Dependencies

- **Story 1.1** (scaffold): project structure, `eslint.config.js`, `eslint-rules/` directory must exist
- **Story 1.4** (signup endpoint / RLS context): for app-side reads of `audit_log_event_types` via RLS-aware client (read-path dependency; this story's writer path uses service-role client via `tx` parameter)

**Enables (blocked until this story is done):**
- Story 9.1 (`audit_log` partitioned table — its FK `audit_log.event_type → audit_log_event_types.event_type` requires this lookup table to exist first)
- Every event-emitting story across Epics 4–12 (all import `writeAuditEvent`)

---

## File-Touch List

### New files

| File | Purpose |
|------|---------|
| `supabase/migrations/20260430120730_create_audit_log_event_types.sql` | Creates `audit_log_priority` enum + `audit_log_event_types` table + seeds 26 rows per AD20 taxonomy |
| `shared/audit/writer.js` | `writeAuditEvent` SSoT — the single permitted INSERT path to `audit_log` |
| `shared/audit/event-types.js` | `EVENT_TYPES` constant + 26 `@typedef PayloadFor<EventType>` shapes |
| `eslint-rules/no-raw-INSERT-audit-log.js` | Custom ESLint rule: flags raw `INSERT INTO audit_log` or `from('audit_log').insert(...)` outside `shared/audit/writer.js` |
| `tests/shared/audit/writer.test.js` | Unit tests for `writeAuditEvent` (UnknownEventTypeError, null payload rejection, eventType guard) |
| `tests/integration/audit-event-types.test.js` | Integration test: `SELECT COUNT(*) FROM audit_log_event_types` = 26; all 26 rows present; enum values correct |

### Modified files

| File | Change |
|------|--------|
| `eslint.config.js` | Load `no-raw-INSERT-audit-log` rule from `./eslint-rules/` |
| `tests/integration/rls-regression.test.js` | Extend `CUSTOMER_SCOPED_TABLES` registry — NOTE: `audit_log_event_types` is a lookup table (NOT customer-scoped), so it does NOT go in `CUSTOMER_SCOPED_TABLES`; no RLS policy needed on this table (read-only reference data, publicly readable within the service) |

---

## Acceptance Criteria

### AC1 — Migration: `audit_log_priority` enum + `audit_log_event_types` table + 26-row seed

**Given** the migration `20260430120730_create_audit_log_event_types.sql`
**When** I apply it
**Then** the `audit_log_priority` enum is created with three values: `'atencao'`, `'notavel'`, `'rotina'` (lowercase taxonomic, no diacritics for SQL safety per architecture pattern doc)
**And** the `audit_log_event_types` lookup table exists with columns: `event_type TEXT PRIMARY KEY`, `priority audit_log_priority NOT NULL`, `description TEXT NOT NULL` (PT-localized hint)
**And** the migration seeds **exactly 26 rows** matching architecture AD20's enumerated taxonomy:

- **7 Atenção rows (`priority = 'atencao'`):**
  - `anomaly-freeze` — *"Mudança externa de preço >40% — congelado para revisão"*
  - `circuit-breaker-trip` — *"Disjuntor ativado — mais de 20% do catálogo impactado num ciclo"*
  - `circuit-breaker-per-sku-trip` — *"Disjuntor por SKU ativado — 15 falhas num ciclo"*
  - `key-validation-fail` — *"Chave da API Worten inválida ou revogada"*
  - `pri01-fail-persistent` — *"Falha persistente na submissão de preços PRI01"*
  - `payment-failure-pause` — *"Pagamento falhou — motor pausado aguardando regularização"*
  - `shop-name-collision-detected` — *"Colisão de nome de loja detetada no P11 — SKU ignorado no ciclo"*

- **8 Notável rows (`priority = 'notavel'`):**
  - `external-change-absorbed` — *"Alteração externa de preço absorvida dentro da tolerância"*
  - `position-won` — *"Posição 1 conquistada neste ciclo"*
  - `position-lost` — *"Posição 1 perdida neste ciclo"*
  - `new-competitor-entered` — *"Novo concorrente entrou no mercado para este SKU"*
  - `large-price-move-within-tolerance` — *"Movimento de preço significativo mas dentro da banda de tolerância"*
  - `customer-paused` — *"Motor pausado pelo cliente"*
  - `customer-resumed` — *"Motor retomado pelo cliente"*
  - `scan-complete-with-issues` — *"Scan completo mas com SKUs problemáticos"*

- **11 Rotina rows (`priority = 'rotina'`):**
  - `undercut-decision` — *"Decisão de undercut aplicada neste ciclo"*
  - `ceiling-raise-decision` — *"Decisão de aumento até ao teto aplicada neste ciclo"*
  - `hold-floor-bound` — *"Preço mantido — limite de floor atingido"*
  - `hold-ceiling-bound` — *"Preço mantido — limite de ceiling atingido"*
  - `hold-already-in-1st` — *"Preço mantido — já em 1.ª posição"*
  - `cycle-start` — *"Ciclo iniciado para este cliente/marketplace"*
  - `cycle-end` — *"Ciclo concluído"*
  - `pri01-submit` — *"Lote PRI01 submetido"*
  - `pri02-complete` — *"Importação PRI01 confirmada como completa"*
  - `pri02-failed-transient` — *"Importação PRI01 falhou transientemente — será resubmetida"*
  - `tier-transition` — *"SKU transitou de tier neste ciclo"*

**And** an integration test asserts `SELECT COUNT(*) FROM audit_log_event_types` returns exactly 26
**And** there is **no FK from `audit_log_event_types.event_type` to anything** (it's a lookup table; FKs flow inward — `audit_log.event_type → audit_log_event_types.event_type` is added in Story 9.1's migration)

**Migration ordering note (F5 amendment):** File `20260430120730_create_audit_log_event_types.sql` uses the 14-digit timestamp `20260430120730` (YYYYMMDDHHMMSS) to ensure it runs **before** `202604301208_create_audit_log_partitioned.sql` (Story 9.1). Supabase CLI applies migrations in lexicographic filename order; `20260430120730` sorts before `202604301208` because at position 11 `'7' < '8'`, preserving the F5 ordering invariant without renumbering existing migrations.

---

### AC2 — `shared/audit/event-types.js`: `EVENT_TYPES` constant + JSDoc `@typedef` shapes

**Given** `shared/audit/event-types.js`
**When** I open the file
**Then** it exports a `EVENT_TYPES` constant (object literal) mirroring all 26 seeded rows, keyed by a JS-friendly name mapping to the hyphenated event_type string:

```js
export const EVENT_TYPES = {
  ANOMALY_FREEZE: 'anomaly-freeze',
  CIRCUIT_BREAKER_TRIP: 'circuit-breaker-trip',
  CIRCUIT_BREAKER_PER_SKU_TRIP: 'circuit-breaker-per-sku-trip',
  KEY_VALIDATION_FAIL: 'key-validation-fail',
  PRI01_FAIL_PERSISTENT: 'pri01-fail-persistent',
  PAYMENT_FAILURE_PAUSE: 'payment-failure-pause',
  SHOP_NAME_COLLISION_DETECTED: 'shop-name-collision-detected',
  EXTERNAL_CHANGE_ABSORBED: 'external-change-absorbed',
  POSITION_WON: 'position-won',
  POSITION_LOST: 'position-lost',
  NEW_COMPETITOR_ENTERED: 'new-competitor-entered',
  LARGE_PRICE_MOVE_WITHIN_TOLERANCE: 'large-price-move-within-tolerance',
  CUSTOMER_PAUSED: 'customer-paused',
  CUSTOMER_RESUMED: 'customer-resumed',
  SCAN_COMPLETE_WITH_ISSUES: 'scan-complete-with-issues',
  UNDERCUT_DECISION: 'undercut-decision',
  CEILING_RAISE_DECISION: 'ceiling-raise-decision',
  HOLD_FLOOR_BOUND: 'hold-floor-bound',
  HOLD_CEILING_BOUND: 'hold-ceiling-bound',
  HOLD_ALREADY_IN_1ST: 'hold-already-in-1st',
  CYCLE_START: 'cycle-start',
  CYCLE_END: 'cycle-end',
  PRI01_SUBMIT: 'pri01-submit',
  PRI02_COMPLETE: 'pri02-complete',
  PRI02_FAILED_TRANSIENT: 'pri02-failed-transient',
  TIER_TRANSITION: 'tier-transition',
};
```

**And** for each event_type, a JSDoc `@typedef PayloadFor<EventType>` documents the structured payload shape.
Example shapes (non-exhaustive):
- `PayloadForAnomalyFreeze = { previousListPriceCents: number, suspectedListPriceCents: number, deviationPct: number, skuId: string }`
- `PayloadForExternalChangeAbsorbed = { previousListPriceCents: number, newListPriceCents: number, deviationPct: number }`
- `PayloadForUndercutDecision = { previousPriceCents: number, newPriceCents: number, competitorPriceCents: number, floorPriceCents: number }`
- `PayloadForCeilingRaiseDecision = { previousPriceCents: number, newPriceCents: number, ceilingPriceCents: number, competitor2ndPriceCents: number }`
- `PayloadForTierTransition = { fromTier: string, toTier: string, reason: string }`
- `PayloadForCycleStart = { tierBreakdown: Record<string, number> }`
- `PayloadForCycleEnd = { skusProcessed: number, undercutCount: number, ceilingRaiseCount: number, holdCount: number, failureCount: number }`
- `PayloadForPri01Submit = { importId: string, skuCount: number }`
- `PayloadForCircuitBreakerTrip = { affectedPct: number, affectedCount: number, cycleId: string }`

**And** subagents adding a new event_type (e.g., Story 12.1's `cycle-fail-sustained`, Story 12.3's `platform-features-changed`) MUST add the migration row + the `EVENT_TYPES` constant entry + the `@typedef` in the same PR — no partial additions.

---

### AC3 — `shared/audit/writer.js`: `writeAuditEvent` function

**Given** `shared/audit/writer.js` exports `writeAuditEvent({ tx, customerMarketplaceId, skuId, skuChannelId, eventType, cycleId, payload })`
**When** called inside an active transaction (the `tx` parameter is the transaction client from `shared/db/tx.js`)
**Then** the function INSERTs into `audit_log` (table created in Story 9.1) with the provided fields:
- `customer_marketplace_id` — required, NOT NULL
- `sku_id` — optional (null outside SKU context; Story 9.1 has NO FK per F8 amendment)
- `sku_channel_id` — optional (null outside SKU context; Story 9.1 has NO FK per F8 amendment)
- `event_type` — required, must be a value from `EVENT_TYPES`
- `cycle_id` — optional (null outside cycle context)
- `payload` — required NON-NULL JSONB (architecture mandates structured payload, never freeform string)
- `priority` is **NOT** explicitly set by `writeAuditEvent` — it is derived by Story 9.1's `audit_log_set_priority` BEFORE INSERT trigger (which does `SELECT priority FROM audit_log_event_types WHERE event_type = NEW.event_type`)

**And** if `eventType` is not present in the `EVENT_TYPES` constant (i.e., not a recognized value), the function throws `UnknownEventTypeError` (this is an additional app-layer guard; Story 9.1 also adds a DB-level RAISE EXCEPTION on the trigger as a belt-and-suspenders check)

**And** if `payload` is null/undefined, the function throws `NullAuditPayloadError` (architecture mandates: every event_type has a documented `@typedef PayloadFor<EventType>`; null payload is a programming error)

**And** the function signature is JSDoc-documented with `@param`, `@returns`, `@throws`

**Implementation note:** Story 9.0 ships the writer module but the `audit_log` table does not exist yet (it's created in Story 9.1). The writer should be implemented so it is correct and complete, but integration tests that actually INSERT rows require Story 9.1's table. Unit tests can mock the `tx` object.

---

### AC4 — Custom ESLint rule: `no-raw-INSERT-audit-log`

**Given** the custom ESLint rule `eslint-rules/no-raw-INSERT-audit-log.js`
**When** ESLint runs on any file in the project
**Then** any of the following patterns OUTSIDE `shared/audit/writer.js` triggers a lint error with message: `"Raw audit_log INSERT forbidden. Use shared/audit/writer.js's writeAuditEvent for all audit emissions."`:

1. Raw SQL containing `INSERT INTO audit_log` (case-insensitive template literal or string)
2. Supabase-style `.from('audit_log').insert(...)` call chain

**And** the allowlist is `shared/audit/writer.js` (the only legitimate INSERT path)

**And** `eslint.config.js` is updated to load this rule from `./eslint-rules/no-raw-INSERT-audit-log.js`

**And** the rule is registered in Story 1.1's existing ESLint config (i.e., `eslint.config.js` at repo root)

---

### AC5 — Calendar-early shipping order (non-code AC)

**Given** the calendar-early shipping order documented in `sprint-status.yaml` under `CALENDAR-EARLY INSERTION`
**When** BAD's coordinator selects stories from the backlog
**Then** Stories 9.0 and 9.1 are scheduled to ship BEFORE Story 5.1 (dispatcher) — even though Epic 9's UI portion (Stories 9.2–9.6) ships in §I phase 7 order (after Epic 8)
**And** the sprint-status.yaml entry for `9-0-writeauditevent-ssot-module-audit-log-event-types-lookup-table-26-row-ad20-taxonomy-seed` is flipped to `ready-for-dev` when this story spec is created (already done by Step 1 story creator)

---

## Implementation Notes

### Migration file naming (F5 amendment)
The migration file uses filename `20260430120730_create_audit_log_event_types.sql` — the 14-digit timestamp `20260430120730` ensures lexicographic ordering puts it BEFORE `202604301208_create_audit_log_partitioned.sql` (`'7' < '8'` at position 11). This is the F5 amendment. Supabase CLI v2.98.1 rejects letter suffixes; the fully-numeric 14-digit prefix is the correct form.

### No RLS on `audit_log_event_types`
The lookup table is reference data shared across all tenants. It does NOT contain customer data. No RLS policy is needed. Story 2.2's RLS regression suite (`CUSTOMER_SCOPED_TABLES` registry) should NOT include this table.

### Writer implementation while `audit_log` table is absent
Story 9.0 ships `shared/audit/writer.js` before Story 9.1 creates the `audit_log` table. The writer is complete code — it composes the INSERT SQL correctly — but any attempt to actually call it will fail at runtime until Story 9.1 runs. This is expected and acceptable; the pattern matches how other SSoT modules ship before their backing infrastructure (e.g., `shared/mirakl/api-client.js` ships in Story 3.1 before all endpoint wrappers exist).

### `writeAuditEvent` atomicity requirement (Bundle B pattern)
`writeAuditEvent` MUST always be called inside an active transaction (`tx` parameter). The function takes a `tx` (transaction client) and performs the INSERT within it. It must NEVER open its own transaction internally. This ensures audit event emission and state mutation (e.g., `transitionCronState`) are always atomic — they share the same `tx`.

### Priority derivation is DB-side (Story 9.1 trigger)
The `priority` column on `audit_log` is set by the `audit_log_set_priority` BEFORE INSERT trigger (created in Story 9.1). `writeAuditEvent` does NOT set `priority` explicitly. However, the `EVENT_TYPES` constant in `event-types.js` MAY include a `priorities` map as a reference (for callers who want to display priority without a DB round-trip), but the canonical source of truth for the actual row's priority is always the trigger.

### ESLint rule scope
The `no-raw-INSERT-audit-log` rule should detect:
1. Template literals or string concatenation containing the substring `INSERT INTO audit_log` (case-insensitive AST scan)
2. MemberExpression chains matching `.from('audit_log')` followed by `.insert(`

The rule's allowlist file check uses `context.getFilename()` normalized to forward slashes; match against `shared/audit/writer.js` suffix. Bob's sprint-status notes confirm this rule joins the deferred-rule pattern: it ships WITH the SSoT module it protects (epics.md L3675).

### `integration_test_required` assessment
Story 9.0 introduces a SQL migration and touches the DB client factory pattern indirectly. Per the sprint-status policy:
- The migration itself is "pure schema + seed data" → would normally be exempt
- But the integration test asserting `COUNT(*) = 26` qualifies as a DB contract surface
- **Decision:** `integration_test_required: true` for Story 9.0 — the `tests/integration/audit-event-types.test.js` integration test must pass on a live local Supabase instance before Phase 4.5 gate clears.

---

## Out of Scope for This Story

The following are explicitly deferred to later stories:
- `audit_log` partitioned base table, priority-derivation trigger, initial partitions, compound indexes → **Story 9.1**
- `shared/audit/readers.js` (query helpers for 5 audit surfaces) → **Story 9.3**
- Story 12.1's `cycle-fail-sustained` event type (27th row) → **Story 12.1** (added via new migration)
- Story 12.3's `platform-features-changed` event type (28th row) → **Story 12.3** (added via new migration)
- Any UI surface for audit events → **Stories 9.3–9.5**
- RLS policies on `audit_log` → **Story 9.1**
