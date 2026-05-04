// shared/audit/event-types.js
//
// SSoT module: EVENT_TYPES constant (26-entry object literal) + JSDoc @typedef
// PayloadFor<EventType> shapes for every event type in the AD20 audit taxonomy.
//
// Story 9.0 / AC#2 — ships as a calendar-early module (before Epic 3, before
// Story 5.1's dispatcher, before Epic 4 onboarding events).
//
// All 26 base event types are defined here.
// Story 12.1 adds `CYCLE_FAIL_SUSTAINED` (27th row) via a new migration + an
// additional entry here.
// Story 12.3 adds `PLATFORM_FEATURES_CHANGED` (28th row) similarly.
//
// Subagent rule: when adding a new event type, you MUST update all three
// artefacts in the same PR:
//   1. A new `supabase/migrations/...` file inserting the row.
//   2. A new constant entry in this file.
//   3. A new `@typedef PayloadFor<EventType>` below.
//
// Priority reference (derived by DB trigger in Story 9.1 — canonical source of
// truth is `audit_log_event_types.priority`; this JS reference is informational
// only, for callers that want to surface priority without a DB round-trip):
//
//   Atenção  (atencao):  ANOMALY_FREEZE, CIRCUIT_BREAKER_TRIP,
//                        CIRCUIT_BREAKER_PER_SKU_TRIP, KEY_VALIDATION_FAIL,
//                        PRI01_FAIL_PERSISTENT, PAYMENT_FAILURE_PAUSE,
//                        SHOP_NAME_COLLISION_DETECTED
//   Notável  (notavel):  EXTERNAL_CHANGE_ABSORBED, POSITION_WON, POSITION_LOST,
//                        NEW_COMPETITOR_ENTERED, LARGE_PRICE_MOVE_WITHIN_TOLERANCE,
//                        CUSTOMER_PAUSED, CUSTOMER_RESUMED, SCAN_COMPLETE_WITH_ISSUES
//   Rotina   (rotina):   UNDERCUT_DECISION, CEILING_RAISE_DECISION, HOLD_FLOOR_BOUND,
//                        HOLD_CEILING_BOUND, HOLD_ALREADY_IN_1ST, CYCLE_START,
//                        CYCLE_END, PRI01_SUBMIT, PRI02_COMPLETE, PRI02_FAILED_TRANSIENT,
//                        TIER_TRANSITION

// ---------------------------------------------------------------------------
// EVENT_TYPES constant — 26 base entries (AD20 taxonomy)
// ---------------------------------------------------------------------------

/**
 * Enumeration of all valid audit event type slugs.
 * Keys are SCREAMING_SNAKE_CASE JS identifiers; values are the hyphenated
 * slugs stored in `audit_log_event_types.event_type` and in `audit_log.event_type`.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const EVENT_TYPES = Object.freeze({
  // --- Atenção (7) ---
  ANOMALY_FREEZE:                   'anomaly-freeze',
  CIRCUIT_BREAKER_TRIP:             'circuit-breaker-trip',
  CIRCUIT_BREAKER_PER_SKU_TRIP:     'circuit-breaker-per-sku-trip',
  KEY_VALIDATION_FAIL:              'key-validation-fail',
  PRI01_FAIL_PERSISTENT:            'pri01-fail-persistent',
  PAYMENT_FAILURE_PAUSE:            'payment-failure-pause',
  SHOP_NAME_COLLISION_DETECTED:     'shop-name-collision-detected',

  // --- Notável (8) ---
  EXTERNAL_CHANGE_ABSORBED:         'external-change-absorbed',
  POSITION_WON:                     'position-won',
  POSITION_LOST:                    'position-lost',
  NEW_COMPETITOR_ENTERED:           'new-competitor-entered',
  LARGE_PRICE_MOVE_WITHIN_TOLERANCE: 'large-price-move-within-tolerance',
  CUSTOMER_PAUSED:                  'customer-paused',
  CUSTOMER_RESUMED:                 'customer-resumed',
  SCAN_COMPLETE_WITH_ISSUES:        'scan-complete-with-issues',

  // --- Rotina (11) ---
  UNDERCUT_DECISION:                'undercut-decision',
  CEILING_RAISE_DECISION:           'ceiling-raise-decision',
  HOLD_FLOOR_BOUND:                 'hold-floor-bound',
  HOLD_CEILING_BOUND:               'hold-ceiling-bound',
  HOLD_ALREADY_IN_1ST:              'hold-already-in-1st',
  CYCLE_START:                      'cycle-start',
  CYCLE_END:                        'cycle-end',
  PRI01_SUBMIT:                     'pri01-submit',
  PRI02_COMPLETE:                   'pri02-complete',
  PRI02_FAILED_TRANSIENT:           'pri02-failed-transient',
  TIER_TRANSITION:                  'tier-transition',
});

// ---------------------------------------------------------------------------
// JSDoc @typedef PayloadFor<EventType> — structured payload shapes
//
// Every `writeAuditEvent` call MUST supply a non-null payload matching the
// shape documented here. The `payload` column is JSONB (NOT NULL) in
// `audit_log` (Story 9.1). Null payload is a programming error and throws
// NullAuditPayloadError (see shared/audit/writer.js).
// ---------------------------------------------------------------------------

/**
 * @typedef {object} PayloadForAnomalyFreeze
 * @property {number} previousListPriceCents - Price before the anomalous external change
 * @property {number} suspectedListPriceCents - Suspicious new list price detected
 * @property {number} deviationPct - Percentage deviation that triggered the freeze
 * @property {string} skuId - Affected SKU UUID
 */

/**
 * @typedef {object} PayloadForCircuitBreakerTrip
 * @property {number} affectedPct - Percentage of catalog affected in this cycle
 * @property {number} affectedCount - Number of SKUs affected
 * @property {string} cycleId - Cycle UUID that triggered the breaker
 */

/**
 * @typedef {object} PayloadForCircuitBreakerPerSkuTrip
 * @property {string} skuId - Affected SKU UUID
 * @property {number} failureCount - Number of consecutive failures that triggered the per-SKU breaker
 * @property {string} cycleId - Cycle UUID at time of trip
 */

/**
 * @typedef {object} PayloadForKeyValidationFail
 * @property {string} marketplaceName - Name of the marketplace whose API key failed
 * @property {string} errorCode - HTTP status or error code returned by Mirakl
 */

/**
 * @typedef {object} PayloadForPri01FailPersistent
 * @property {string} importId - PRI01 import batch ID
 * @property {number} failureCount - How many consecutive failures occurred
 * @property {string} lastErrorMessage - Last error returned by Mirakl PRI01
 */

/**
 * @typedef {object} PayloadForPaymentFailurePause
 * @property {string} stripePaymentIntentId - Stripe PaymentIntent that failed
 * @property {string} failureReason - Stripe decline code or error message
 */

/**
 * @typedef {object} PayloadForShopNameCollisionDetected
 * @property {string} skuId - Affected SKU UUID
 * @property {string} collidingShopName - Shop name that collided with ours in P11
 * @property {string} cycleId - Cycle UUID at time of detection
 */

/**
 * @typedef {object} PayloadForExternalChangeAbsorbed
 * @property {number} previousListPriceCents - Price before the external change
 * @property {number} newListPriceCents - New absorbed price
 * @property {number} deviationPct - Deviation percentage (within tolerance band)
 */

/**
 * @typedef {object} PayloadForPositionWon
 * @property {number} ourPriceCents - Our price that won 1st position
 * @property {number} competitorPriceCents - Nearest competitor price
 * @property {string} cycleId - Cycle UUID
 */

/**
 * @typedef {object} PayloadForPositionLost
 * @property {number} ourPriceCents - Our price at time of loss
 * @property {number} winnerPriceCents - Competitor price that took 1st position
 * @property {string} cycleId - Cycle UUID
 */

/**
 * @typedef {object} PayloadForNewCompetitorEntered
 * @property {string} skuId - Affected SKU UUID
 * @property {number} competitorPriceCents - New competitor's price
 * @property {string} cycleId - Cycle UUID
 */

/**
 * @typedef {object} PayloadForLargePriceMoveWithinTolerance
 * @property {number} previousPriceCents - Price before the move
 * @property {number} newPriceCents - Price after the move
 * @property {number} deviationPct - Deviation percentage (within tolerance)
 */

/**
 * @typedef {object} PayloadForCustomerPaused
 * @property {string} pausedBy - User ID or system actor that paused the engine
 * @property {string} [reason] - Optional free-text reason
 */

/**
 * @typedef {object} PayloadForCustomerResumed
 * @property {string} resumedBy - User ID or system actor that resumed the engine
 */

/**
 * @typedef {object} PayloadForScanCompleteWithIssues
 * @property {number} totalSkus - Total SKUs scanned in this cycle
 * @property {number} issueCount - Number of SKUs with issues
 * @property {string[]} issueSlugs - Event type slugs summarising the issue types encountered
 */

/**
 * @typedef {object} PayloadForUndercutDecision
 * @property {number} previousPriceCents - Price before the undercut
 * @property {number} newPriceCents - New undercut price
 * @property {number} competitorPriceCents - Competitor price that was undercut
 * @property {number} floorPriceCents - Floor price at time of decision
 */

/**
 * @typedef {object} PayloadForCeilingRaiseDecision
 * @property {number} previousPriceCents - Price before the ceiling raise
 * @property {number} newPriceCents - New raised price
 * @property {number} ceilingPriceCents - Ceiling price at time of decision
 * @property {number} competitor2ndPriceCents - Second competitor's price (the new target to stay under)
 */

/**
 * @typedef {object} PayloadForHoldFloorBound
 * @property {number} ourPriceCents - Our current price (at floor)
 * @property {number} floorPriceCents - Floor price that was reached
 * @property {number} competitorPriceCents - Competitor price we cannot undercut
 */

/**
 * @typedef {object} PayloadForHoldCeilingBound
 * @property {number} ourPriceCents - Our current price (at ceiling)
 * @property {number} ceilingPriceCents - Ceiling price that was reached
 */

/**
 * @typedef {object} PayloadForHoldAlreadyIn1st
 * @property {number} ourPriceCents - Our current price (already winning)
 */

/**
 * @typedef {object} PayloadForCycleStart
 * @property {Record<string, number>} tierBreakdown - Map of tier name → SKU count at cycle start
 */

/**
 * @typedef {object} PayloadForCycleEnd
 * @property {number} skusProcessed - Total SKUs processed in this cycle
 * @property {number} undercutCount - SKUs where undercut decision was applied
 * @property {number} ceilingRaiseCount - SKUs where ceiling raise was applied
 * @property {number} holdCount - SKUs where price was held
 * @property {number} failureCount - SKUs that failed processing
 */

/**
 * @typedef {object} PayloadForPri01Submit
 * @property {string} importId - PRI01 import batch ID assigned by Mirakl
 * @property {number} skuCount - Number of SKUs included in this PRI01 batch
 */

/**
 * @typedef {object} PayloadForPri02Complete
 * @property {string} importId - PRI01 import batch ID that completed
 * @property {number} acceptedCount - Number of SKUs accepted by Mirakl
 * @property {number} rejectedCount - Number of SKUs rejected by Mirakl
 */

/**
 * @typedef {object} PayloadForPri02FailedTransient
 * @property {string} importId - PRI01 import batch ID that failed transiently
 * @property {string} errorMessage - Error message returned by Mirakl
 * @property {number} attemptNumber - Which attempt number this failure represents
 */

/**
 * @typedef {object} PayloadForTierTransition
 * @property {string} fromTier - Previous tier name (e.g. 'tier1', 'tier2a', 'tier2b', 'tier3')
 * @property {string} toTier - New tier name
 * @property {string} reason - Human-readable reason for the tier change
 */
