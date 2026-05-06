# Story 4.1: customer_marketplaces Schema with F4 PROVISIONING + cron_state Machine + Transitions Matrix

**Sprint-status key:** `4-1-customer-marketplaces-schema-with-f4-provisioning-cron-state-machine-transitions-matrix`
**Status:** ready-for-dev
**Size:** L
**Epic:** Epic 4 — Customer Onboarding (architecture S-I phase 4)
**Atomicity:** Bundle B (1/2) — schema half; Story 4.4 is the population half. Safe to merge alone — this story creates no rows; only Story 4.3 (key-entry) creates PROVISIONING rows, which are blocked from merging until Story 4.4 lands (see `merge_blocks` in sprint-status.yaml).
**Depends on:** Stories 1.4, 2.1, 2.2, 9.0, 9.1 (all `done`)

---

## Narrative

**As a** system with a signed-up customer who has passed Story 9.0's audit-event foundation,
**I want** the `customer_marketplaces` table (with F4 PROVISIONING state + nullable A01/PC01 columns + CHECK constraint) and the `shared/state/cron-state.js` SSoT module (with `transitionCronState`) and the `shared/state/transitions-matrix.js` module (with `LEGAL_CRON_TRANSITIONS`),
**So that** every subsequent story that transitions cron state uses a single, audited, concurrency-safe path — and the Epic 4 scan orchestration (Story 4.4) has a valid schema to populate.

---

## Trace

- **Architecture decisions:** AD6 (channel_pricing_mode enum), AD10 (tier system — schema columns only, engine logic Epic 7), AD15 (cron_state enum + 8 values + transitions spec), AD16 (F4: PROVISIONING state + nullable A01/PC01 + CHECK constraint), AD26 (PC01 capture columns)
- **Amendments:** F4 (PROVISIONING + nullable A01/PC01 + CHECK constraint), F13 (cron_state UPPER_SNAKE_CASE)
- **FRs:** FR8 (foundation for key entry), FR17 (sku_channels schema — schema columns only, engine Epic 7)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/02-epic-4-onboarding.md`, Story 4.1
- **Architecture patterns:** `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md`
- **Database schema DDL:** `_bmad-output/planning-artifacts/architecture-distillate/06-database-schema.md` (customer_marketplaces section)
- **Decisions detail:** `_bmad-output/planning-artifacts/architecture-distillate/02-decisions-A-D.md` (AD15, AD16)

---

## RLS Regression Debt — MANDATORY (Epic 2 Retro Item 6)

This story **MUST** pay the forward-debt from Epic 2. Three files, three tasks — all in the same PR:

1. **`db/seed/test/two-customers.sql`** — add one `customer_marketplaces` row per test customer (both in PROVISIONING with A01/PC01 columns NULL — satisfies F4 CHECK constraint)
2. **`tests/integration/rls-regression.test.js`** — add `customer_marketplaces` to the `CUSTOMER_SCOPED_TABLES` registry
3. **`tests/integration/rls-regression.test.js`** — replace the placeholder test `rls_isolation_shop_api_key_vault_deferred_awaiting_epic4` with a live row-level isolation test (now that `customer_marketplaces` rows are in the seed, `shop_api_key_vault` can be FK-referenced and tested)

**Without all three**, this story is incomplete and will fail review.

---

## Pre-Existing Test Scaffold — Do NOT Recreate

The test file is **already committed** at `tests/shared/state/cron-state.test.js`. Do NOT recreate or modify the scaffold structure. ATDD Step 2 fills in the `if (process.env.INTEGRATION_TESTS)` stubs. The non-integration unit tests (AC#5–AC#8) are **already live** and run without a DB:

- `transitions_matrix_exports_legal_cron_transitions_object`
- `transitions_matrix_contains_all_12_legal_pairs`
- `illegal_transition_pair_not_in_matrix`
- `unit_test_legal_transition_succeeds`
- `unit_test_illegal_transition_throws_before_db`
- `unit_test_concurrent_transition_throws`
- `negative_assertion_no_raw_cron_state_update_outside_ssot`

These tests **will fail until the SSoT modules exist**. Create the modules first; the tests are the contract.

---

## Acceptance Criteria

### AC#1 — Migration creates full customer_marketplaces table

**Given** the migration `supabase/migrations/202604301203_create_customer_marketplaces.sql`
**When** I apply it
**Then** the table exists per architecture DDL (see Database Schema section below) with:
- PK `uuid`, `customer_id FK` CASCADE, `operator marketplace_operator`, `marketplace_instance_url text`
- A01 columns (shop_id bigint, shop_name, shop_state, currency_iso_code, is_professional, channels text[]) — **ALL NULLABLE**
- PC01 columns (channel_pricing_mode, operator_csv_delimiter, offer_prices_decimals, discount_period_required, competitive_pricing_tool, scheduled_pricing, volume_pricing, multi_currency, order_tax_mode, platform_features_snapshot JSONB, last_pc01_pulled_at) — **ALL NULLABLE**
- Engine config columns (max_discount_pct `numeric(5,4) NOT NULL`, max_increase_pct `numeric(5,4) NOT NULL DEFAULT 0.0500`, edge_step_cents `integer NOT NULL DEFAULT 1`, anomaly_threshold_pct `numeric(5,4)` nullable, tier_cadence_minutes_override `jsonb` nullable)
- State columns (cron_state enum DEFAULT `'PROVISIONING'`, cron_state_changed_at `timestamptz NOT NULL DEFAULT NOW()`)
- Stripe linkage (stripe_subscription_item_id text UNIQUE) — `NULL` until first Go-Live
- Timestamps (created_at, updated_at `timestamptz NOT NULL DEFAULT NOW()`)

**And** the cron_state enum has exactly 8 UPPER_SNAKE_CASE values: `PROVISIONING`, `DRY_RUN`, `ACTIVE`, `PAUSED_BY_CUSTOMER`, `PAUSED_BY_PAYMENT_FAILURE`, `PAUSED_BY_CIRCUIT_BREAKER`, `PAUSED_BY_KEY_REVOKED`, `PAUSED_BY_ACCOUNT_GRACE_PERIOD`
**And** channel_pricing_mode enum has 3 values: `SINGLE`, `MULTI`, `DISABLED`
**And** csv_delimiter enum has 2 values: `COMMA`, `SEMICOLON`
**And** marketplace_operator enum has 1 value at MVP: `WORTEN`

### AC#2 — F4 CHECK constraint enforces A01/PC01 completeness before leaving PROVISIONING

**Given** the CHECK constraint `customer_marketplace_provisioning_completeness`
**When** the migration creates it
**Then**:
- `INSERT` with `cron_state = 'PROVISIONING'` and ALL A01/PC01 columns NULL → **succeeds**
- `INSERT` with `cron_state = 'DRY_RUN'` and any A01 or PC01 column NULL → **fails** (SQLSTATE `23514`)
- `UPDATE SET cron_state = 'DRY_RUN'` while any A01/PC01 column is NULL → **fails** (SQLSTATE `23514`)

The CHECK asserts: `cron_state = 'PROVISIONING' OR (shop_id IS NOT NULL AND shop_name IS NOT NULL AND shop_state IS NOT NULL AND currency_iso_code IS NOT NULL AND is_professional IS NOT NULL AND channels IS NOT NULL AND channel_pricing_mode IS NOT NULL AND operator_csv_delimiter IS NOT NULL AND offer_prices_decimals IS NOT NULL AND discount_period_required IS NOT NULL AND competitive_pricing_tool IS NOT NULL AND scheduled_pricing IS NOT NULL AND volume_pricing IS NOT NULL AND multi_currency IS NOT NULL AND order_tax_mode IS NOT NULL AND platform_features_snapshot IS NOT NULL AND last_pc01_pulled_at IS NOT NULL)`

### AC#3 — Indexes and UNIQUE constraint

**Given** the migration
**When** I inspect the schema
**Then** the following indexes exist:
- `idx_customer_marketplaces_customer_id` ON `customer_marketplaces(customer_id)`
- `idx_customer_marketplaces_cron_state_active` ON `customer_marketplaces(id) WHERE cron_state = 'ACTIVE'` (partial index)
- `idx_customer_marketplaces_last_pc01_pulled_at` ON `customer_marketplaces(last_pc01_pulled_at)` (for monthly PC01 re-pull cron, AD26)

**And** UNIQUE constraint `(customer_id, operator, shop_id)` prevents accidental dup-add

### AC#4 — RLS policies + regression suite extension

**Given** RLS policies in the same migration
**When** customer A is logged in
**Then**:
- `SELECT FROM customer_marketplaces WHERE id = <customer_B_marketplace_id>` returns 0 rows
- UPDATE/DELETE attempts on customer B's row fail
- Founder admin via service role can read all rows

**And** `db/seed/test/two-customers.sql` gains one `customer_marketplaces` row per test customer (both PROVISIONING, A01/PC01 NULL)
**And** `tests/integration/rls-regression.test.js`'s `CUSTOMER_SCOPED_TABLES` registry includes `customer_marketplaces`
**And** the placeholder `rls_isolation_shop_api_key_vault_deferred_awaiting_epic4` is replaced with a real row-level isolation test against `shop_api_key_vault` (now that the FK target `customer_marketplaces` is seeded)

### AC#5 — LEGAL_CRON_TRANSITIONS matrix in transitions-matrix.js

**Given** `shared/state/transitions-matrix.js` exports `LEGAL_CRON_TRANSITIONS`
**When** I open the file
**Then** it is a JS object literal at the top of the module documenting every legal `(from, to)` pair:

```js
export const LEGAL_CRON_TRANSITIONS = {
  PROVISIONING:                  ['DRY_RUN'],
  DRY_RUN:                       ['ACTIVE'],
  ACTIVE:                        ['PAUSED_BY_CUSTOMER', 'PAUSED_BY_PAYMENT_FAILURE', 'PAUSED_BY_CIRCUIT_BREAKER', 'PAUSED_BY_KEY_REVOKED', 'PAUSED_BY_ACCOUNT_GRACE_PERIOD'],
  PAUSED_BY_CUSTOMER:            ['ACTIVE'],
  PAUSED_BY_PAYMENT_FAILURE:     ['ACTIVE'],
  PAUSED_BY_CIRCUIT_BREAKER:     ['ACTIVE'],
  PAUSED_BY_KEY_REVOKED:         ['ACTIVE'],
  PAUSED_BY_ACCOUNT_GRACE_PERIOD: ['DRY_RUN'],
};
```

This yields exactly **12 legal (from, to) pairs** total (count the values: 1+1+5+1+1+1+1+1 = 12).
The matrix is the **single spec** — NOT buried in `transitionCronState` conditionals.

The 12 legal transitions are:
1. `PROVISIONING → DRY_RUN` (scan complete, A01/PC01 populated)
2. `DRY_RUN → ACTIVE` (Go-Live click)
3. `ACTIVE → PAUSED_BY_CUSTOMER` (pause click)
4. `PAUSED_BY_CUSTOMER → ACTIVE` (resume click)
5. `ACTIVE → PAUSED_BY_PAYMENT_FAILURE` (Stripe webhook final-failure)
6. `PAUSED_BY_PAYMENT_FAILURE → ACTIVE` (customer re-enters payment + re-Go-Lives)
7. `ACTIVE → PAUSED_BY_CIRCUIT_BREAKER` (circuit-breaker trip)
8. `PAUSED_BY_CIRCUIT_BREAKER → ACTIVE` (manual unblock)
9. `ACTIVE → PAUSED_BY_KEY_REVOKED` (401 detected)
10. `PAUSED_BY_KEY_REVOKED → ACTIVE` (rotation flow validates new key)
11. `ACTIVE → PAUSED_BY_ACCOUNT_GRACE_PERIOD` (deletion initiated — emits NO audit event per AD20 Q2)
12. `PAUSED_BY_ACCOUNT_GRACE_PERIOD → DRY_RUN` (cancel-mid-grace; customer must re-enter Stripe per AD21)

### AC#6 — transitionCronState SSoT module

**Given** `shared/state/cron-state.js` exports `transitionCronState({tx, client, customerMarketplaceId, from, to, context})`
**When** called inside an active transaction
**Then**:
- Validates `(from, to)` against `LEGAL_CRON_TRANSITIONS` **BEFORE** issuing any SQL
- Illegal transition → throws `InvalidTransitionError` with no DB write
- Issues optimistic-concurrency UPDATE: `UPDATE customer_marketplaces SET cron_state = $to, cron_state_changed_at = NOW() WHERE id = $cmId AND cron_state = $from`
- 0 rows updated → throws `ConcurrentTransitionError`
- Dispatches to AD20 audit event per the static `AUDIT_EVENT_MAP` at top of module (see below)
- Transitions WITHOUT an audit event counterpart do **NOT** call `writeAuditEvent` (no error, no null event)

**Audit event map** (documented in JSDoc of `transitionCronState`):

| (from, to) | event_type | Priority |
|---|---|---|
| `(ACTIVE, PAUSED_BY_CUSTOMER)` | `customer-paused` | Notável |
| `(PAUSED_BY_CUSTOMER, ACTIVE)` | `customer-resumed` | Notável |
| `(ACTIVE, PAUSED_BY_CIRCUIT_BREAKER)` | `circuit-breaker-trip` | Atenção |
| `(ACTIVE, PAUSED_BY_PAYMENT_FAILURE)` | `payment-failure-pause` | Atenção |
| `(ACTIVE, PAUSED_BY_KEY_REVOKED)` | `key-validation-fail` | Atenção |

**Transitions that emit NO audit event** (per AD20 Q2 decision):
- `PROVISIONING → DRY_RUN`
- `DRY_RUN → ACTIVE` (Go-Live click)
- `ACTIVE → PAUSED_BY_ACCOUNT_GRACE_PERIOD` (deletion-initiated — email trail is the record; audit_log rows self-erase at T+7d anyway)
- All manual unblocks back to ACTIVE (`PAUSED_BY_PAYMENT_FAILURE → ACTIVE`, `PAUSED_BY_CIRCUIT_BREAKER → ACTIVE`, `PAUSED_BY_KEY_REVOKED → ACTIVE`, `PAUSED_BY_ACCOUNT_GRACE_PERIOD → DRY_RUN`)

JSDoc **MUST** explicitly enumerate which transitions emit and which don't.

### AC#7 — Unit tests in cron-state.test.js (non-integration)

**Given** the non-integration unit tests in the pre-existing `tests/shared/state/cron-state.test.js`
**When** I run `node --test tests/shared/state/cron-state.test.js`
**Then** these tests pass (they run without a DB — use mocked `tx` + `client`):
- `unit_test_legal_transition_succeeds`
- `unit_test_illegal_transition_throws_before_db`
- `unit_test_concurrent_transition_throws`
- `transitions_matrix_exports_legal_cron_transitions_object`
- `transitions_matrix_contains_all_12_legal_pairs`
- `illegal_transition_pair_not_in_matrix`
- `negative_assertion_no_raw_cron_state_update_outside_ssot`

### AC#8 — ESLint `no-raw-cron-state-update` rule

**Given** `eslint-rules/no-raw-cron-state-update.js`
**When** ESLint runs on a file containing `UPDATE customer_marketplaces SET cron_state` raw SQL outside `shared/state/cron-state.js`
**Then** ESLint reports an error

**And** grepping `app/src/`, `worker/src/`, `shared/`, `scripts/` for `UPDATE customer_marketplaces SET cron_state` finds **zero matches** outside `shared/state/cron-state.js`

---

## Database Schema (Verbatim DDL — Implement Exactly)

```sql
-- Enums (create BEFORE the table)
CREATE TYPE cron_state AS ENUM (
  'PROVISIONING',
  'DRY_RUN',
  'ACTIVE',
  'PAUSED_BY_CUSTOMER',
  'PAUSED_BY_PAYMENT_FAILURE',
  'PAUSED_BY_CIRCUIT_BREAKER',
  'PAUSED_BY_KEY_REVOKED',
  'PAUSED_BY_ACCOUNT_GRACE_PERIOD'
);
CREATE TYPE channel_pricing_mode AS ENUM ('SINGLE', 'MULTI', 'DISABLED');
CREATE TYPE csv_delimiter AS ENUM ('COMMA', 'SEMICOLON');
CREATE TYPE marketplace_operator AS ENUM ('WORTEN');   -- enum extends in Epic 2

CREATE TABLE customer_marketplaces (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id                     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  operator                        marketplace_operator NOT NULL,
  marketplace_instance_url        text NOT NULL,

  -- A01 capture (AD16 step 2). F4: NULLABLE while cron_state = 'PROVISIONING'.
  shop_id                         bigint,
  shop_name                       text,
  shop_state                      text,
  currency_iso_code               text,
  is_professional                 boolean,
  channels                        text[],

  -- PC01 capture (AD16 step 3, AD26 monthly re-pull). F4: NULLABLE while PROVISIONING.
  channel_pricing_mode            channel_pricing_mode,
  operator_csv_delimiter          csv_delimiter,
  offer_prices_decimals           smallint,
  discount_period_required        boolean,
  competitive_pricing_tool        boolean,
  scheduled_pricing               boolean,
  volume_pricing                  boolean,
  multi_currency                  boolean,
  order_tax_mode                  text,
  platform_features_snapshot      jsonb,
  last_pc01_pulled_at             timestamptz,

  -- Engine config (per-marketplace). Phase 2 reservations: anomaly_threshold_pct, tier_cadence_minutes_override, edge_step_cents.
  max_discount_pct                numeric(5,4) NOT NULL,
  max_increase_pct                numeric(5,4) NOT NULL DEFAULT 0.0500,
  edge_step_cents                 integer NOT NULL DEFAULT 1,
  anomaly_threshold_pct           numeric(5,4),
  tier_cadence_minutes_override   jsonb,

  -- State machine (F4, F13 UPPER_SNAKE_CASE)
  cron_state                      cron_state NOT NULL DEFAULT 'PROVISIONING',
  cron_state_changed_at           timestamptz NOT NULL DEFAULT NOW(),

  -- Stripe linkage (F2 corrected): per-marketplace SubscriptionItem only
  stripe_subscription_item_id     text UNIQUE,

  created_at                      timestamptz NOT NULL DEFAULT NOW(),
  updated_at                      timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE (customer_id, operator, shop_id),

  -- F4: leaving PROVISIONING requires all A01/PC01 captures populated
  CONSTRAINT customer_marketplace_provisioning_completeness
    CHECK (
      cron_state = 'PROVISIONING'
      OR (
        shop_id IS NOT NULL AND shop_name IS NOT NULL AND shop_state IS NOT NULL
        AND currency_iso_code IS NOT NULL AND is_professional IS NOT NULL AND channels IS NOT NULL
        AND channel_pricing_mode IS NOT NULL AND operator_csv_delimiter IS NOT NULL
        AND offer_prices_decimals IS NOT NULL AND discount_period_required IS NOT NULL
        AND competitive_pricing_tool IS NOT NULL AND scheduled_pricing IS NOT NULL
        AND volume_pricing IS NOT NULL AND multi_currency IS NOT NULL
        AND order_tax_mode IS NOT NULL AND platform_features_snapshot IS NOT NULL
        AND last_pc01_pulled_at IS NOT NULL
      )
    )
);

CREATE INDEX idx_customer_marketplaces_customer_id ON customer_marketplaces(customer_id);
CREATE INDEX idx_customer_marketplaces_cron_state_active
  ON customer_marketplaces(id) WHERE cron_state = 'ACTIVE';
CREATE INDEX idx_customer_marketplaces_last_pc01_pulled_at
  ON customer_marketplaces(last_pc01_pulled_at);

-- RLS policies (include in same migration for atomic deploy per Step 5 pattern)
ALTER TABLE customer_marketplaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_marketplaces_select_own ON customer_marketplaces
  FOR SELECT USING (customer_id = auth.uid());

CREATE POLICY customer_marketplaces_modify_own ON customer_marketplaces
  FOR ALL USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());
```

**Important:** Include RLS policies in the **same migration file** — this is the Step 5 atomicity pattern (every customer-scoped table migration includes its RLS policy). The RLS regression suite verifies coverage.

---

## SSoT Modules to Create

### `shared/state/transitions-matrix.js`

```js
/**
 * Legal cron_state transition matrix.
 * This is the single authoritative spec — NOT buried in conditionals.
 * Every consumer of transitionCronState() derives legal/illegal from this module.
 * 12 legal (from, to) pairs total.
 *
 * @type {Record<string, string[]>}
 */
export const LEGAL_CRON_TRANSITIONS = {
  PROVISIONING:                   ['DRY_RUN'],
  DRY_RUN:                        ['ACTIVE'],
  ACTIVE:                         ['PAUSED_BY_CUSTOMER', 'PAUSED_BY_PAYMENT_FAILURE',
                                   'PAUSED_BY_CIRCUIT_BREAKER', 'PAUSED_BY_KEY_REVOKED',
                                   'PAUSED_BY_ACCOUNT_GRACE_PERIOD'],
  PAUSED_BY_CUSTOMER:             ['ACTIVE'],
  PAUSED_BY_PAYMENT_FAILURE:      ['ACTIVE'],
  PAUSED_BY_CIRCUIT_BREAKER:      ['ACTIVE'],
  PAUSED_BY_KEY_REVOKED:          ['ACTIVE'],
  PAUSED_BY_ACCOUNT_GRACE_PERIOD: ['DRY_RUN'],
};
```

### `shared/state/cron-state.js`

Required shape (implement with full JSDoc + all error classes + audit dispatch):

```js
import { LEGAL_CRON_TRANSITIONS } from './transitions-matrix.js';
import { writeAuditEvent } from '../audit/writer.js';

// Static audit event map — (from, to) → event_type string or null (no event)
// Documented verbatim here as the authoritative lookup, per AC#6.
const AUDIT_EVENT_MAP = {
  'ACTIVE->PAUSED_BY_CUSTOMER':        'customer-paused',
  'PAUSED_BY_CUSTOMER->ACTIVE':        'customer-resumed',
  'ACTIVE->PAUSED_BY_CIRCUIT_BREAKER': 'circuit-breaker-trip',
  'ACTIVE->PAUSED_BY_PAYMENT_FAILURE': 'payment-failure-pause',
  'ACTIVE->PAUSED_BY_KEY_REVOKED':     'key-validation-fail',
  // All other legal transitions emit NO audit event (null):
  // PROVISIONING→DRY_RUN, DRY_RUN→ACTIVE, all PAUSED_*→ACTIVE unblocks,
  // ACTIVE→PAUSED_BY_ACCOUNT_GRACE_PERIOD, PAUSED_BY_ACCOUNT_GRACE_PERIOD→DRY_RUN
};

export class InvalidTransitionError extends Error {
  constructor (from, to) {
    super(`Illegal cron_state transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class ConcurrentTransitionError extends Error {
  constructor (customerMarketplaceId, from) {
    super(`Concurrent cron_state transition detected for ${customerMarketplaceId} (expected from=${from})`);
    this.name = 'ConcurrentTransitionError';
    this.customerMarketplaceId = customerMarketplaceId;
    this.from = from;
  }
}

/**
 * Atomically transition customer_marketplace.cron_state.
 * Must be called inside a transaction; throws before any DB write for illegal transitions.
 *
 * Audit events emitted (transitionCronState calls writeAuditEvent in same tx):
 *   ACTIVE→PAUSED_BY_CUSTOMER        → customer-paused (Notável)
 *   PAUSED_BY_CUSTOMER→ACTIVE        → customer-resumed (Notável)
 *   ACTIVE→PAUSED_BY_CIRCUIT_BREAKER → circuit-breaker-trip (Atenção)
 *   ACTIVE→PAUSED_BY_PAYMENT_FAILURE → payment-failure-pause (Atenção)
 *   ACTIVE→PAUSED_BY_KEY_REVOKED     → key-validation-fail (Atenção)
 *
 * Transitions that emit NO audit event:
 *   PROVISIONING→DRY_RUN (scan complete — no taxonomy entry per AD20)
 *   DRY_RUN→ACTIVE (Go-Live click — handled by Stripe webhook events, not state machine event)
 *   ACTIVE→PAUSED_BY_ACCOUNT_GRACE_PERIOD (deletion-initiated; email trail is canonical; rows self-erase at T+7d)
 *   All manual unblocks back to ACTIVE or DRY_RUN
 *
 * @param {object} opts
 * @param {function} opts.tx - Transaction helper from shared/db/tx.js
 * @param {object} opts.client - DB client (pg Pool client)
 * @param {string} opts.customerMarketplaceId - UUID
 * @param {string} opts.from - Expected current cron_state (optimistic concurrency)
 * @param {string} opts.to - Target cron_state
 * @param {object} [opts.context] - Additional payload for audit event
 * @returns {Promise<void>}
 * @throws {InvalidTransitionError} if (from, to) not in LEGAL_CRON_TRANSITIONS
 * @throws {ConcurrentTransitionError} if 0 rows updated (concurrent modification)
 */
export async function transitionCronState ({ tx, client, customerMarketplaceId, from, to, context = {} }) {
  // 1. Validate BEFORE any DB call
  const allowed = LEGAL_CRON_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(from, to);
  }

  // 2. Optimistic-concurrency UPDATE
  const result = await client.query(
    `UPDATE customer_marketplaces
     SET cron_state = $1, cron_state_changed_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND cron_state = $3`,
    [to, customerMarketplaceId, from],
  );

  if (result.rowCount === 0) {
    throw new ConcurrentTransitionError(customerMarketplaceId, from);
  }

  // 3. Conditional audit event (same transaction; null = no event)
  const eventType = AUDIT_EVENT_MAP[`${from}->${to}`] ?? null;
  if (eventType !== null) {
    await writeAuditEvent({
      tx,
      client,
      customerMarketplaceId,
      eventType,
      payload: { from, to, ...context },
    });
  }
}
```

**Notes for Amelia:**
- The pre-existing unit tests mock `tx` as `async (client, cb) => cb(client)` and pass `client` with a `.query()` method. Match this signature exactly.
- `writeAuditEvent` is imported from `shared/audit/writer.js` (Story 9.0 — already done). For unit tests, `writeAuditEvent` must not be called on transitions without audit events (assert with a mock that tracks calls).
- The `tx` parameter is present for future use by callers who need to wrap multiple operations in a single transaction; `transitionCronState` itself is called with the client directly in the UPDATE.

---

## ESLint Rule: `no-raw-cron-state-update`

Create `eslint-rules/no-raw-cron-state-update.js`:

```js
/**
 * ESLint rule: no-raw-cron-state-update
 * Flags any raw SQL string containing 'UPDATE customer_marketplaces SET cron_state'
 * outside the SSoT module shared/state/cron-state.js.
 *
 * Ships with Story 4.1 per the custom ESLint rule deferred-rule pattern
 * (epics-distillate/_index.md Orientation §6).
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Raw cron_state UPDATE must go through shared/state/cron-state.js SSoT',
    },
    messages: {
      noRawCronStateUpdate:
        'Raw cron_state UPDATE detected. Use transitionCronState() from shared/state/cron-state.js instead.',
    },
  },
  create (context) {
    const SSOT = 'shared/state/cron-state.js';
    const filename = context.getFilename().replace(/\\/g, '/');
    if (filename.endsWith(SSOT)) return {}; // allow inside SSoT itself

    return {
      Literal (node) {
        if (
          typeof node.value === 'string' &&
          /UPDATE\s+customer_marketplaces\s+SET\s+cron_state/i.test(node.value)
        ) {
          context.report({ node, messageId: 'noRawCronStateUpdate' });
        }
      },
      TemplateLiteral (node) {
        const raw = node.quasis.map((q) => q.value.raw).join('');
        if (/UPDATE\s+customer_marketplaces\s+SET\s+cron_state/i.test(raw)) {
          context.report({ node, messageId: 'noRawCronStateUpdate' });
        }
      },
    };
  },
};
```

Wire it into `eslint.config.js` under the project's custom rules block (follow the same pattern as `no-direct-fetch.js` from Story 3.1):

```js
// In eslint.config.js — add to the existing custom rules block
import noRawCronStateUpdate from './eslint-rules/no-raw-cron-state-update.js';

// In the rules section:
'local/no-raw-cron-state-update': 'error',

// In the plugins section:
plugins: { local: { rules: { 'no-raw-cron-state-update': noRawCronStateUpdate, /* ...existing */ } } }
```

---

## File-Touch List

### New files (create)

| File | Purpose |
|------|---------|
| `supabase/migrations/202604301203_create_customer_marketplaces.sql` | Full DDL + RLS policies (see Database Schema section) |
| `shared/state/transitions-matrix.js` | `LEGAL_CRON_TRANSITIONS` object literal |
| `shared/state/cron-state.js` | `transitionCronState`, `InvalidTransitionError`, `ConcurrentTransitionError` |
| `eslint-rules/no-raw-cron-state-update.js` | Custom ESLint rule |

### Modified files

| File | Change |
|------|--------|
| `eslint.config.js` | Wire `no-raw-cron-state-update` rule |
| `db/seed/test/two-customers.sql` | Add `customer_marketplaces` row per test customer (PROVISIONING, A01/PC01 NULL) |
| `tests/integration/rls-regression.test.js` | Add `customer_marketplaces` to `CUSTOMER_SCOPED_TABLES` registry + replace deferred `shop_api_key_vault` test |

### Pre-existing (do NOT modify structure, only fill in stubs at ATDD Step 2)

| File | Status |
|------|--------|
| `tests/shared/state/cron-state.test.js` | ALREADY EXISTS — scaffold committed; unit tests live; integration stubs need filling |
| `shared/audit/writer.js` | ALREADY EXISTS — `writeAuditEvent` from Story 9.0 |
| `shared/audit/event-types.js` | ALREADY EXISTS — `EVENT_TYPES` constant from Story 9.0 |
| `shared/db/tx.js` | ALREADY EXISTS — `tx` helper from Story 2.1 |
| `shared/db/rls-aware-client.js` | ALREADY EXISTS — Story 2.1 |
| `shared/db/service-role-client.js` | ALREADY EXISTS — Story 2.1 |

---

## Critical Constraints (Do Not Violate)

1. **UPPER_SNAKE_CASE for all cron_state enum values** (F13 amendment). Never lowercase: `'ACTIVE'` not `'active'`.

2. **No `export default`** anywhere (architecture cross-cutting constraint). Use only named exports: `export class`, `export function`, `export const`.

3. **No `.then()` chains** — async/await only.

4. **No `console.log`** — pino only (though this story has no runtime logging; the ESLint rule will catch it if you slip).

5. **Transitions matrix is the spec** — `transitionCronState` reads `LEGAL_CRON_TRANSITIONS`; it does NOT re-enumerate transitions in its own `if`/`switch` logic.

6. **writeAuditEvent must be called in the same transaction** — this is the Bundle B atomicity pattern. The caller passes `tx` and `client`; `transitionCronState` passes the same `client` to `writeAuditEvent`.

7. **RLS policies in the same migration file** — atomic deploy per architecture Step 5 process. Do NOT create a separate migration for RLS.

8. **`max_discount_pct` has no DEFAULT** (Story 4.3 sets it from the margin form; Story 4.8 writes it). INSERT will fail if not provided — that is intentional. Don't add a DEFAULT.

9. **ESLint rule path** — the rule file lives in `eslint-rules/` (project root), not `shared/` or `app/`. Follow the `no-direct-fetch.js` pattern from Story 3.1.

10. **No raw `UPDATE customer_marketplaces SET cron_state` SQL** anywhere outside `shared/state/cron-state.js`. The ESLint rule you're creating this story will catch violations. Check yourself before committing.

---

## SSoT Consumption Map (What Consumes These Modules)

Once this story ships, the following downstream stories import from `shared/state/`:

| Story | Module consumed | How |
|-------|----------------|-----|
| 4.4 (atomicity sibling) | `transitionCronState` | `PROVISIONING → DRY_RUN` after scan completes |
| 5.1 (cron dispatcher) | `transitionCronState` | `ACTIVE → PAUSED_BY_CIRCUIT_BREAKER` on circuit-breaker trip |
| 7.6 (circuit-breaker) | `transitionCronState` | Circuit-breaker trip transition |
| 8.5 (pause/resume) | `transitionCronState` | `ACTIVE ↔ PAUSED_BY_CUSTOMER` |
| 8.6 (Go-Live) | `transitionCronState` | `DRY_RUN → ACTIVE` |
| 8.9 (interceptions) | `LEGAL_CRON_TRANSITIONS` | State-routing logic |
| 10.1 (deletion initiation) | `transitionCronState` | `<current> → PAUSED_BY_ACCOUNT_GRACE_PERIOD` with `eventType: null` |
| 10.2 (cancel-mid-grace) | `transitionCronState` | `PAUSED_BY_ACCOUNT_GRACE_PERIOD → DRY_RUN` |
| 11.2 (Stripe webhook) | `transitionCronState` | `ACTIVE → PAUSED_BY_PAYMENT_FAILURE` etc. |

**Never create a parallel cron_state update path.** All must go through `transitionCronState`.

---

## Integration Test Gate

This story is tagged `integration_test_required: true` in `sprint-status.yaml`. The Phase 4.5 gate will halt after BAD's batch completes and require Pedro to run `npm run test:integration` locally against a running local Supabase docker.

Integration tests that ATDD Step 2 must make live (filling in the stubs in `tests/shared/state/cron-state.test.js` under the `if (process.env.INTEGRATION_TESTS)` block):

- Schema assertions (table + enum values + columns)
- F4 CHECK constraint pass/fail tests
- Index existence via `pg_indexes`
- RLS isolation (customer A cannot read/update/delete customer B rows)
- `transitionCronState` integration (real DB: optimistic concurrency, audit event emission)

Run the non-integration tests first (no DB needed): `node --test tests/shared/state/cron-state.test.js`

---

## Previous Story Learnings (from Epic 3 — Patterns to Preserve)

From Story 3.1 (ESLint rule + SSoT module pattern):
- **Comments must not contain `fetch(` substring** — the `no-direct-fetch` rule does a plain `src.includes('fetch(')` scan. Similarly, comments in `cron-state.js` must not contain `UPDATE customer_marketplaces SET cron_state` verbatim — the negative-assertion test in the test scaffold uses a regex scan.
- **Named exports only** — `export class`, `export const`, `export function` — no `export default`.
- **`catch {}` (no binding) preferred** for unused error bindings.

From Story 2.2 (RLS regression suite — AD30 patterns):
- The `CUSTOMER_SCOPED_TABLES` registry in `tests/integration/rls-regression.test.js` is the forward-discipline safety net. Extending it here closes the `shop_api_key_vault` deferred test from Epic 2.
- The seed in `db/seed/test/two-customers.sql` must have rows for EVERY table in `CUSTOMER_SCOPED_TABLES` — the convention test asserts this.
- RLS policies use `auth.uid()` as the customer_id comparator — do NOT use a subquery for `customer_marketplaces` since `customer_id` is directly on the table.

From Story 9.0 (writeAuditEvent SSoT):
- `writeAuditEvent` signature: `writeAuditEvent({ tx, client, customerMarketplaceId, eventType, cycleId, skuId, skuChannelId, payload })`. The `cycleId`, `skuId`, `skuChannelId` are optional (null for state-machine-level events). For `transitionCronState`, pass only `{ tx, client, customerMarketplaceId, eventType, payload }`.
- `eventType` must be in `EVENT_TYPES` from `shared/audit/event-types.js` — the trigger `audit_log_set_priority` will throw if it's not in the lookup table. `customer-paused`, `customer-resumed`, `circuit-breaker-trip`, `payment-failure-pause`, `key-validation-fail` are all in the 26-row base seed from Story 9.0.

---

## Pattern Compliance Checklist

Before marking done:

- [ ] `supabase/migrations/202604301203_create_customer_marketplaces.sql` — DDL + all 4 enum types + CHECK constraint + 3 indexes + UNIQUE + RLS policies in same file
- [ ] `shared/state/transitions-matrix.js` — named export `LEGAL_CRON_TRANSITIONS`, plain object, no default export
- [ ] `shared/state/cron-state.js` — named exports `transitionCronState`, `InvalidTransitionError`, `ConcurrentTransitionError`; `AUDIT_EVENT_MAP` at top; reads from `LEGAL_CRON_TRANSITIONS`; no inline transition conditionals
- [ ] `eslint-rules/no-raw-cron-state-update.js` — AST-walking Literal + TemplateLiteral check; skips SSoT file itself
- [ ] `eslint.config.js` — wired correctly
- [ ] `db/seed/test/two-customers.sql` — both test customers have `customer_marketplaces` row in PROVISIONING with A01/PC01 NULL
- [ ] `tests/integration/rls-regression.test.js` — `customer_marketplaces` in `CUSTOMER_SCOPED_TABLES` registry; `shop_api_key_vault` deferred test replaced
- [ ] `node --test tests/shared/state/cron-state.test.js` — all 7 non-integration tests pass
- [ ] ESLint 0 errors: `npx eslint shared/state/ eslint-rules/no-raw-cron-state-update.js`
- [ ] Negative-assertion grep clean: `grep -r "UPDATE customer_marketplaces SET cron_state" app/ worker/ shared/ scripts/ supabase/migrations/` finds only `shared/state/cron-state.js`
- [ ] No `export default` in any new file
- [ ] No `.then()` chains
- [ ] No `console.log`

---

## Dev Agent Record

### Agent Model Used

_To be filled in by dev agent_

### Completion Notes

_To be filled in by dev agent_

### File List

_To be filled in by dev agent_
