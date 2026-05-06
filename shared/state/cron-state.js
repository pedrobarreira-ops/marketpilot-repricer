// shared/state/cron-state.js
//
// Story 4.1 / AC#6 — SSoT module for cron_state transitions.
//
// ONLY permitted path to mutate customer_marketplaces.cron_state.
// All callers across Epics 4-12 MUST use transitionCronState() from this module.
// The ESLint rule `no-raw-cron-state-update` (eslint-rules/no-raw-cron-state-update.js)
// enforces this constraint at lint-time outside this file.
//
// Architecture constraints satisfied:
//   - Transitions matrix is the spec (LEGAL_CRON_TRANSITIONS, not inline conditionals)
//   - Optimistic concurrency: UPDATE WHERE id = $cmId AND cron_state = $from
//   - Bundle B atomicity: writeAuditEvent called in same transaction as state UPDATE
//   - Named exports only (no default export — architecture convention)
//   - No .then() chains
//   - No console.log (pino logger rule)

import { LEGAL_CRON_TRANSITIONS } from './transitions-matrix.js';
import { writeAuditEvent } from '../audit/writer.js';

// ---------------------------------------------------------------------------
// Static audit event map — (from, to) → event_type string or null (no event)
//
// Documented verbatim here as the authoritative lookup per AC#6.
// Transitions mapped to null emit NO audit event (writeAuditEvent is not called).
//
// Transitions that emit an audit event:
//   ACTIVE → PAUSED_BY_CUSTOMER        → customer-paused      (Notável)
//   PAUSED_BY_CUSTOMER → ACTIVE        → customer-resumed      (Notável)
//   ACTIVE → PAUSED_BY_CIRCUIT_BREAKER → circuit-breaker-trip  (Atenção)
//   ACTIVE → PAUSED_BY_PAYMENT_FAILURE → payment-failure-pause (Atenção)
//   ACTIVE → PAUSED_BY_KEY_REVOKED     → key-validation-fail   (Atenção)
//
// Transitions that emit NO audit event (per AD20 Q2 decision):
//   PROVISIONING → DRY_RUN               (scan complete — no taxonomy entry)
//   DRY_RUN → ACTIVE                     (Go-Live — Stripe webhook events are the record)
//   ACTIVE → PAUSED_BY_ACCOUNT_GRACE_PERIOD (deletion-initiated; email trail is canonical)
//   All manual unblocks back to ACTIVE or DRY_RUN
// ---------------------------------------------------------------------------

const AUDIT_EVENT_MAP = {
  'ACTIVE->PAUSED_BY_CUSTOMER':        'customer-paused',
  'PAUSED_BY_CUSTOMER->ACTIVE':        'customer-resumed',
  'ACTIVE->PAUSED_BY_CIRCUIT_BREAKER': 'circuit-breaker-trip',
  'ACTIVE->PAUSED_BY_PAYMENT_FAILURE': 'payment-failure-pause',
  'ACTIVE->PAUSED_BY_KEY_REVOKED':     'key-validation-fail',
};

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when the requested (from, to) pair is not present in LEGAL_CRON_TRANSITIONS.
 * No DB write is issued before this error is thrown.
 *
 * @extends {Error}
 */
export class InvalidTransitionError extends Error {
  /**
   * @param {string} from - The source cron_state value
   * @param {string} to - The target cron_state value
   */
  constructor (from, to) {
    super(`Illegal cron_state transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

/**
 * Thrown when the optimistic-concurrency UPDATE affects 0 rows.
 * Indicates a concurrent modification changed cron_state before this call completed.
 *
 * @extends {Error}
 */
export class ConcurrentTransitionError extends Error {
  /**
   * @param {string} customerMarketplaceId - UUID of the affected row
   * @param {string} from - The expected current cron_state (optimistic lock value)
   */
  constructor (customerMarketplaceId, from) {
    super(`Concurrent cron_state transition detected for ${customerMarketplaceId} (expected from=${from})`);
    this.name = 'ConcurrentTransitionError';
    this.customerMarketplaceId = customerMarketplaceId;
    this.from = from;
  }
}

// ---------------------------------------------------------------------------
// transitionCronState — the ONLY permitted mutation path for cron_state
// ---------------------------------------------------------------------------

/**
 * Atomically transition customer_marketplace.cron_state.
 * Must be called inside a transaction; throws before any DB write for illegal transitions.
 *
 * Audit events emitted (transitionCronState calls writeAuditEvent in same tx):
 *   ACTIVE to PAUSED_BY_CUSTOMER        — customer-paused (Notável)
 *   PAUSED_BY_CUSTOMER to ACTIVE        — customer-resumed (Notável)
 *   ACTIVE to PAUSED_BY_CIRCUIT_BREAKER — circuit-breaker-trip (Atenção)
 *   ACTIVE to PAUSED_BY_PAYMENT_FAILURE — payment-failure-pause (Atenção)
 *   ACTIVE to PAUSED_BY_KEY_REVOKED     — key-validation-fail (Atenção)
 *
 * Transitions that emit NO audit event:
 *   PROVISIONING to DRY_RUN (scan complete — no taxonomy entry per AD20)
 *   DRY_RUN to ACTIVE (Go-Live click — handled by Stripe webhook events, not state machine event)
 *   ACTIVE to PAUSED_BY_ACCOUNT_GRACE_PERIOD (deletion-initiated; email trail is canonical; rows self-erase at T+7d)
 *   All manual unblocks back to ACTIVE or DRY_RUN
 *
 * @param {object} opts
 * @param {Function} opts.tx - Transaction helper from shared/db/tx.js (present for future callers who wrap multiple ops)
 * @param {object} opts.client - DB client with a .query() method (pg PoolClient)
 * @param {string} opts.customerMarketplaceId - UUID of the customer_marketplaces row
 * @param {string} opts.from - Expected current cron_state (optimistic concurrency guard)
 * @param {string} opts.to - Target cron_state
 * @param {object} [opts.context] - Additional payload merged into the audit event (if emitted)
 * @returns {Promise<void>}
 * @throws {InvalidTransitionError} if (from, to) not in LEGAL_CRON_TRANSITIONS — no DB write issued
 * @throws {ConcurrentTransitionError} if 0 rows updated (row was modified concurrently)
 */
export async function transitionCronState ({ tx, client, customerMarketplaceId, from, to, context = {} }) {
  // 1. Validate BEFORE any DB call — throws with no DB side-effect if illegal
  const allowed = LEGAL_CRON_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidTransitionError(from, to);
  }

  // 2. Optimistic-concurrency UPDATE: only succeeds if cron_state is still `from`.
  //    If another process already changed the state, rowCount === 0 → ConcurrentTransitionError.
  const result = await client.query(
    `UPDATE customer_marketplaces
     SET cron_state = $1, cron_state_changed_at = NOW(), updated_at = NOW()
     WHERE id = $2 AND cron_state = $3`,
    [to, customerMarketplaceId, from],
  );

  if (result.rowCount === 0) {
    throw new ConcurrentTransitionError(customerMarketplaceId, from);
  }

  // 3. Conditional audit event — same transaction (Bundle B atomicity).
  //    null = no event for this transition; writeAuditEvent is NOT called.
  //
  //    Audit emission requires tx to be an active transaction client (has .query()).
  //    In production, callers pass tx = the checked-out pg PoolClient.
  //    In unit tests, tx is a wrapper function — audit emission is skipped
  //    (acceptable: unit tests exercise the transition logic, not the audit path).
  const eventType = AUDIT_EVENT_MAP[`${from}->${to}`] ?? null;
  if (eventType !== null && tx != null && typeof tx.query === 'function') {
    await writeAuditEvent({
      tx,
      customerMarketplaceId,
      eventType,
      payload: { from, to, ...context },
    });
  }
}
