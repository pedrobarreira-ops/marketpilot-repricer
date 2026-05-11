// worker/src/engine/decide.js
// AD8 — Full engine decision table: per-(SKU, channel) repricing decision.
// Architecture: AD8 (decision table), AD13 (collision detection), AD14 (filter chain),
//               AD7 (pending_import_id precondition), AD9 (coop-absorb STEP 2 stub), AD11 (CB STEP 5 stub).
//
// SINGLE SOURCE OF TRUTH for per-(SKU, channel) decisions.
// Never bypass: engine→decide.js→filterCompetitorOffers→roundFloorCents/roundCeilingCents.
// No raw P11 offer reads after self-filter call.
// No float-price math (no-float-price ESLint rule enforced).

import { filterCompetitorOffers } from '../../../shared/mirakl/self-filter.js';
import { roundFloorCents, roundCeilingCents, toCents } from '../../../shared/money/index.js';
import { EVENT_TYPES } from '../../../shared/audit/event-types.js';
import { createWorkerLogger } from '../../../shared/logger.js';

// NOTE: decide.js does NOT import writeAuditEvent.
// Audit events are returned in the auditEvents[] array and emitted by the caller (cycle-assembly.js).

const logger = createWorkerLogger();

/**
 * @typedef {Object} DecisionResult
 * @property {'UNDERCUT'|'CEILING_RAISE'|'HOLD'|'SKIP'} action
 * @property {number|null} newPriceCents - null for HOLD/SKIP
 * @property {string[]} auditEvents - array of EVENT_TYPES slugs; empty for SKIP-without-audit
 * @property {string} reason - short diagnostic string for pino logging
 */

/**
 * Apply the AD8 full decision table for a single (SKU, channel) pair.
 *
 * @param {object} params
 * @param {object} params.skuChannel - sku_channels row (full)
 * @param {object} params.customerMarketplace - customer_marketplaces row
 * @param {string} params.ownShopName - customer_marketplace.shop_name from A01
 * @param {object[]} params.p11RawOffers - raw offer list from P11 for this (EAN, channel)
 * @param {object} params.tx - transaction-capable DB client
 * @returns {Promise<DecisionResult>}
 */
export async function decideForSkuChannel ({ skuChannel, customerMarketplace, ownShopName, p11RawOffers, tx }) {
  // -------------------------------------------------------------------------
  // PRECONDITIONS — any false → return SKIP (no audit event for plain skips)
  // -------------------------------------------------------------------------

  if (customerMarketplace.cron_state !== 'ACTIVE') {
    logger.debug({ skuChannelId: skuChannel.id, cron_state: customerMarketplace.cron_state }, 'engine: SKIP — cron_state not ACTIVE');
    return { action: 'SKIP', newPriceCents: null, auditEvents: [], reason: 'cron-state-not-active' };
  }

  if (skuChannel.frozen_for_anomaly_review === true) {
    logger.debug({ skuChannelId: skuChannel.id }, 'engine: SKIP — frozen_for_anomaly_review');
    return { action: 'SKIP', newPriceCents: null, auditEvents: [], reason: 'frozen-for-anomaly-review' };
  }

  if (skuChannel.frozen_for_pri01_persistent === true) {
    logger.debug({ skuChannelId: skuChannel.id }, 'engine: SKIP — frozen_for_pri01_persistent');
    return { action: 'SKIP', newPriceCents: null, auditEvents: [], reason: 'frozen-for-pri01-persistent' };
  }

  if (skuChannel.pending_import_id !== null && skuChannel.pending_import_id !== undefined) {
    logger.debug({ skuChannelId: skuChannel.id, pending_import_id: skuChannel.pending_import_id }, 'engine: SKIP — pending_import_id set');
    return { action: 'SKIP', newPriceCents: null, auditEvents: [], reason: 'pending-import' };
  }

  if (skuChannel.excluded_at !== null && skuChannel.excluded_at !== undefined) {
    logger.debug({ skuChannelId: skuChannel.id }, 'engine: SKIP — excluded_at set');
    return { action: 'SKIP', newPriceCents: null, auditEvents: [], reason: 'excluded' };
  }

  // -------------------------------------------------------------------------
  // STEP 1 — Filter chain (AD13+AD14) + collision check + Tier 3 path
  // -------------------------------------------------------------------------

  const { filteredOffers, collisionDetected } = filterCompetitorOffers(p11RawOffers, ownShopName);

  if (collisionDetected) {
    logger.warn({ skuChannelId: skuChannel.id, ownShopName }, 'engine: SKIP — shop_name collision detected (AD13)');
    return {
      action: 'SKIP',
      newPriceCents: null,
      auditEvents: [EVENT_TYPES.SHOP_NAME_COLLISION_DETECTED],
      reason: 'collision',
    };
  }

  // After STEP 1, ALL ranking/math uses filteredOffers ONLY.
  // p11RawOffers is never read again past this point.

  if (filteredOffers.length === 0) {
    // No competitors after filtering → Tier 3 path
    // Story 7.5 handles tier column DB writes; engine returns the event here.
    logger.debug({ skuChannelId: skuChannel.id }, 'engine: HOLD — no competitors after filter (Tier 3)');
    return {
      action: 'HOLD',
      newPriceCents: null,
      auditEvents: [EVENT_TYPES.TIER_TRANSITION],
      reason: 'no-competitors',
    };
  }

  // -------------------------------------------------------------------------
  // STEP 2 — Cooperative-absorption stub (replaced by Story 7.3)
  // -------------------------------------------------------------------------

  let absorb = { absorbed: false, frozen: false, skipped: false };
  try {
    const mod = await import('./cooperative-absorb.js');
    absorb = await mod.absorbExternalChange({ tx, skuChannel, customerMarketplace });
  } catch {
    // Story 7.3 not yet available — continue with pass-through defaults
    logger.debug({ skuChannelId: skuChannel.id }, 'engine: cooperative-absorb stub (7.3 not shipped)');
  }
  if (absorb.skipped || absorb.frozen) {
    return { action: 'SKIP', newPriceCents: null, auditEvents: [], reason: 'cooperative-absorb-skip' };
  }

  // -------------------------------------------------------------------------
  // STEP 3 — Floor / ceiling computation (roundFloorCents/roundCeilingCents from shared/money)
  // Critical rounding directions:
  //   roundFloorCents → Math.ceil (floor never sinks below raw — protects margin)
  //   roundCeilingCents → Math.floor (ceiling never exceeds raw — prevents over-pricing)
  // -------------------------------------------------------------------------

  const floorPriceCents = roundFloorCents(
    skuChannel.list_price_cents * (1 - customerMarketplace.max_discount_pct),
  );
  const ceilingPriceCents = roundCeilingCents(
    skuChannel.list_price_cents * (1 + customerMarketplace.max_increase_pct),
  );

  // -------------------------------------------------------------------------
  // STEP 4 — Position branching (CASE A: contested; CASE B: winning)
  // All arithmetic in integer cents. edge_step_cents is already integer cents.
  // -------------------------------------------------------------------------

  const competitorLowestCents = toCents(filteredOffers[0].total_price);
  const competitor2ndCents = filteredOffers[1] != null ? toCents(filteredOffers[1].total_price) : null;

  // Own position: compare own total (current_price + min_shipping) to competitor lowest
  const ownTotalCents = skuChannel.current_price_cents + (skuChannel.min_shipping_price_cents ?? 0);
  const ownPosition = ownTotalCents <= competitorLowestCents ? 1 : 2; // simplified: 1 (winning) or >1 (contested)

  let candidateCents;
  let decisionAction;
  let decisionAuditEvents;
  let decisionReason;

  if (ownPosition > 1) {
    // CASE A — contested: we are NOT in 1st place; try to undercut
    const targetUndercutCents = competitorLowestCents - customerMarketplace.edge_step_cents;
    candidateCents = Math.max(targetUndercutCents, floorPriceCents);

    if (candidateCents < competitorLowestCents) {
      // Undercut succeeds — candidate is below competitor lowest
      decisionAction = 'UNDERCUT';
      decisionAuditEvents = [EVENT_TYPES.UNDERCUT_DECISION];
      decisionReason = 'undercut';
    } else {
      // candidateCents >= competitorLowestCents: floor-bound (includes tie case)
      // Tie (candidateCents === competitorLowestCents): HOLD — coin-flip with margin sacrifice is worse
      decisionAction = 'HOLD';
      candidateCents = null;
      decisionAuditEvents = [EVENT_TYPES.HOLD_FLOOR_BOUND];
      decisionReason = 'floor-bound';
    }
  } else {
    // CASE B — winning (position == 1): we are already cheapest; try to raise toward ceiling
    candidateCents = null;

    if (competitor2ndCents === null) {
      // No 2nd-place competitor — cannot determine a ceiling-raise target
      decisionAction = 'HOLD';
      decisionAuditEvents = [EVENT_TYPES.HOLD_ALREADY_IN_1ST];
      decisionReason = 'no-2nd';
    } else {
      const targetCeilingCents = competitor2ndCents - customerMarketplace.edge_step_cents;
      const newCeilingCents = Math.min(targetCeilingCents, ceilingPriceCents);

      if (newCeilingCents > skuChannel.current_price_cents) {
        // Ceiling raise is possible — new price is higher than current price
        decisionAction = 'CEILING_RAISE';
        candidateCents = newCeilingCents;
        decisionAuditEvents = [EVENT_TYPES.CEILING_RAISE_DECISION];
        decisionReason = 'ceiling-raise';
      } else {
        // Cannot raise — already at or above ceiling, or ceiling prevents raise
        decisionAction = 'HOLD';
        decisionAuditEvents = [EVENT_TYPES.HOLD_ALREADY_IN_1ST];
        decisionReason = 'already-best';
      }
    }
  }

  // -------------------------------------------------------------------------
  // STEP 5 — Per-SKU circuit-breaker stub (replaced by Story 7.6)
  // -------------------------------------------------------------------------

  if (decisionAction === 'UNDERCUT' || decisionAction === 'CEILING_RAISE') {
    let cbResult = { tripped: false };
    try {
      const cbMod = await import('../safety/circuit-breaker.js');
      cbResult = cbMod.checkPerSkuCircuitBreaker({
        skuChannel,
        newPriceCents: candidateCents,
        currentPriceCents: skuChannel.current_price_cents,
      });
    } catch {
      // Story 7.6 not yet available — pass through
      logger.debug({ skuChannelId: skuChannel.id }, 'engine: per-SKU circuit-breaker stub (7.6 not shipped)');
    }
    if (cbResult.tripped) {
      // Story 7.6 emits the circuit-breaker-per-sku-trip event itself; decide.js returns empty auditEvents
      return { action: 'HOLD', newPriceCents: null, auditEvents: [], reason: 'circuit-breaker' };
    }
  }

  // -------------------------------------------------------------------------
  // STEP 6 — Return decision (caller/cycle-assembly handles staging write + audit events)
  // -------------------------------------------------------------------------

  logger.debug(
    { skuChannelId: skuChannel.id, action: decisionAction, newPriceCents: candidateCents, reason: decisionReason },
    'engine: decision',
  );

  return {
    action: decisionAction,
    newPriceCents: decisionAction === 'UNDERCUT' || decisionAction === 'CEILING_RAISE' ? candidateCents : null,
    auditEvents: decisionAuditEvents,
    reason: decisionReason,
  };
}
