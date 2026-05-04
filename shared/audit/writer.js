// shared/audit/writer.js
//
// SSoT module: `writeAuditEvent` — the ONLY permitted INSERT path into `audit_log`.
//
// Story 9.0 / AC#3 — Bundle B atomicity:
//   writeAuditEvent MUST be called with an active transaction client (`tx`).
//   It NEVER opens its own transaction (BEGIN). Audit event emission and the
//   state mutation that triggered it (e.g., transitionCronState) MUST share
//   the same `tx` to guarantee atomicity.
//
// Priority derivation:
//   The `priority` column on `audit_log` is set by the `audit_log_set_priority`
//   BEFORE INSERT trigger (Story 9.1). `writeAuditEvent` does NOT pass `priority`
//   in the INSERT — the trigger derives it from `audit_log_event_types`.
//
// ESLint rule `no-raw-INSERT-audit-log` (eslint-rules/no-raw-INSERT-audit-log.js)
// forbids any raw `INSERT INTO audit_log` outside this file. All callers across
// Epics 4–12 MUST import and use `writeAuditEvent`.
//
// Implementation note (Story 9.0 → Story 9.1 sequencing):
//   This module ships before Story 9.1 creates the `audit_log` partitioned table.
//   The writer is complete and correct; runtime calls will fail until Story 9.1
//   runs. This is intentional (mirrors `shared/mirakl/api-client.js` shipping
//   before all endpoint wrappers exist).

import { EVENT_TYPES } from './event-types.js';

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown when `writeAuditEvent` is called with an `eventType` value that is
 * not present in the `EVENT_TYPES` constant.
 *
 * @extends {Error}
 */
export class UnknownEventTypeError extends Error {
  /**
   * @param {string} eventType - The unrecognised event type slug
   */
  constructor (eventType) {
    super(`Unknown audit event type: "${eventType}". Must be one of the values in EVENT_TYPES (shared/audit/event-types.js).`);
    this.name = 'UnknownEventTypeError';
    this.eventType = eventType;
  }
}

/**
 * Thrown when `writeAuditEvent` is called with a null or undefined `payload`.
 * Architecture mandates every event type has a structured, non-null payload
 * (NFR-S6 / AD20). Null payload is always a programming error.
 *
 * @extends {Error}
 */
export class NullAuditPayloadError extends Error {
  /**
   * @param {string} eventType - The event type for which payload was missing
   */
  constructor (eventType) {
    super(`payload must be non-null for audit event type "${eventType}". Every event type has a documented @typedef PayloadFor<EventType> — pass a structured object.`);
    this.name = 'NullAuditPayloadError';
    this.eventType = eventType;
  }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** @type {Set<string>} */
const VALID_EVENT_TYPES = new Set(Object.values(EVENT_TYPES));

// ---------------------------------------------------------------------------
// writeAuditEvent — the ONLY permitted INSERT path into audit_log
// ---------------------------------------------------------------------------

/**
 * Inserts one audit event row into `audit_log` using the caller's transaction.
 *
 * Bundle B atomicity invariant: `writeAuditEvent` MUST be called inside an
 * active transaction. It uses the supplied `tx` client and NEVER issues BEGIN
 * internally. The caller owns the transaction boundary.
 *
 * Priority derivation: the `priority` column is set by the `audit_log_set_priority`
 * BEFORE INSERT trigger (Story 9.1). Do NOT pass `priority` here — it is
 * derived DB-side from `audit_log_event_types.priority`.
 *
 * @param {object} params
 * @param {import('pg').PoolClient} params.tx - Active transaction client (MUST already be inside BEGIN)
 * @param {string} params.customerMarketplaceId - UUID of the customer_marketplace row (NOT NULL)
 * @param {string} params.eventType - Must be a value from EVENT_TYPES (shared/audit/event-types.js)
 * @param {object} params.payload - Structured, non-null JSON payload (see @typedef PayloadFor<EventType>)
 * @param {string|null} [params.cycleId] - UUID of the current repricer cycle (null outside cycle context)
 * @param {string|null} [params.skuId] - UUID of the affected SKU (null outside SKU context; Story 9.1 has no FK per F8 amendment)
 * @param {string|null} [params.skuChannelId] - UUID of the affected SKU channel (null outside SKU context; Story 9.1 has no FK per F8 amendment)
 * @returns {Promise<{ id: string }>} The generated UUID of the inserted audit_log row
 * @throws {UnknownEventTypeError} If eventType is not a recognised value from EVENT_TYPES
 * @throws {NullAuditPayloadError} If payload is null or undefined
 * @throws {Error} If tx is null/undefined or lacks a .query() method (Bundle B violation)
 * @throws {Error} If customerMarketplaceId is null, undefined, or empty string
 */
export async function writeAuditEvent ({
  tx,
  customerMarketplaceId,
  eventType,
  payload,
  cycleId = null,
  skuId = null,
  skuChannelId = null,
}) {
  // Guard: tx is required (Bundle B atomicity invariant — caller MUST own the
  // transaction boundary). Without this guard, a missing `tx` surfaces as a
  // late `Cannot read properties of undefined (reading 'query')` which obscures
  // the architectural invariant that's actually being violated.
  if (tx == null || typeof tx.query !== 'function') {
    throw new Error('tx must be an active transaction client with a .query() method — writeAuditEvent NEVER opens its own transaction (Bundle B atomicity invariant; see shared/audit/writer.js header comment)');
  }

  // Guard: customerMarketplaceId is required (rejects null, undefined, AND empty string)
  if (customerMarketplaceId == null || customerMarketplaceId === '') {
    throw new Error('customerMarketplaceId must be a non-empty value — every audit event must be scoped to a customer_marketplace row');
  }

  // Guard: eventType must be a known value
  if (!VALID_EVENT_TYPES.has(eventType)) {
    throw new UnknownEventTypeError(eventType);
  }

  // Guard: payload must be non-null (architecture NFR-S6 / AD20)
  if (payload == null) {
    throw new NullAuditPayloadError(eventType);
  }

  // INSERT — priority is intentionally omitted; derived by Story 9.1 trigger.
  // Columns: customer_marketplace_id, event_type, payload, cycle_id, sku_id, sku_channel_id
  const { rows } = await tx.query(
    `INSERT INTO audit_log
       (customer_marketplace_id, event_type, payload, cycle_id, sku_id, sku_channel_id)
     VALUES
       ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      customerMarketplaceId,
      eventType,
      JSON.stringify(payload),
      cycleId,
      skuId,
      skuChannelId,
    ]
  );

  return rows[0];
}
