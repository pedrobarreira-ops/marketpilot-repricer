// worker/src/safety/circuit-breaker.js
// AD11 — Outbound circuit breaker: per-SKU 15% + per-cycle 20%.
// F6 amendment: per-cycle denominator = full active-SKU count, NOT cycle's scheduled set.
//
// ARCHITECTURE CONTRACTS:
//   checkPerSkuCircuitBreaker — SYNCHRONOUS (no async). Called from engine STEP 5 without await.
//   checkPerCycleCircuitBreaker — async. Called by cycle-assembly after all per-SKU decisions.
//   Side effects (Resend alerts, cron_state transitions) happen via injected deps.
//   No raw SQL state updates — use transitionCronState (shared/state/cron-state.js).
//   No raw audit inserts — writeAuditEvent is NOT called here directly.

import { transitionCronState as _transitionCronState } from '../../../shared/state/cron-state.js';
import { sendCriticalAlert } from '../../../shared/resend/client.js';
import { createWorkerLogger } from '../../../shared/logger.js';

// NOTE: writeAuditEvent is NOT imported here. The circuit-breaker-trip Atenção event
// is emitted internally by transitionCronState (ACTIVE → PAUSED_BY_CIRCUIT_BREAKER).
// Importing writeAuditEvent and calling it would double-emit the event.

const logger = createWorkerLogger();

/**
 * Default sendAlertFn wrapper — formats the circuit-breaker-trip alert for Resend.
 * Injected callers (tests) receive raw { customerMarketplaceId, cycleId, numerator, denominator }.
 *
 * @param {object} opts
 * @param {string} opts.customerMarketplaceId
 * @param {string} opts.cycleId
 * @param {number} opts.numerator
 * @param {number} opts.denominator
 * @returns {Promise<void>}
 */
async function _defaultSendAlertFn ({ customerMarketplaceId, cycleId, numerator, denominator }) {
  const affectedPct = denominator > 0 ? `${numerator}/${denominator}` : 'N/A';
  await sendCriticalAlert({
    to: process.env.ALERT_EMAIL ?? 'alerts@marketpilot.pt',
    subject: `[MarketPilot] Circuit breaker tripped — ${affectedPct} SKUs staged`,
    html: `<p>Per-cycle circuit breaker tripped.</p>
<ul>
  <li><strong>Customer marketplace:</strong> ${customerMarketplaceId}</li>
  <li><strong>Cycle ID:</strong> ${cycleId}</li>
  <li><strong>Staged:</strong> ${numerator} / ${denominator} SKUs (${affectedPct}%)</li>
</ul>
<p>The marketplace has been paused. Manual review and unblock required via the dashboard.</p>`,
  });
}

/**
 * Check the per-SKU 15% circuit breaker.
 * SYNCHRONOUS — no side effects, no async. Called from engine STEP 5 without await.
 *
 * Returns { tripped: true, deltaPct } when the proposed price change exceeds 15%.
 * The caller (cycle-assembly) is responsible for emitting the CIRCUIT_BREAKER_PER_SKU_TRIP
 * audit event and sending the Resend alert when tripped === true.
 *
 * @param {object} params
 * @param {object} params.skuChannel - sku_channels row (used for context logging)
 * @param {number} params.newPriceCents - proposed new price (integer cents)
 * @param {number} params.currentPriceCents - current price (integer cents)
 * @returns {{ tripped: boolean, deltaPct: number }}
 */
export function checkPerSkuCircuitBreaker ({ skuChannel, newPriceCents, currentPriceCents }) {
  const deltaPct = Math.abs(newPriceCents - currentPriceCents) / currentPriceCents;
  const tripped = deltaPct > 0.15;
  if (tripped) {
    logger.warn(
      { skuChannelId: skuChannel.id, deltaPct, newPriceCents, currentPriceCents },
      'circuit-breaker: per-SKU 15% tripped',
    );
  }
  return { tripped, deltaPct };
}

/**
 * Check the per-cycle 20% circuit breaker.
 * Called by cycle-assembly after all per-SKU decisions are staged, before PRI01 flush.
 *
 * F6 amendment: denominator = full active-SKU count for marketplace, NOT cycle's scheduled set.
 * This prevents constant triggering on small-catalog excerpts during partial scans.
 *
 * Manual unblock (Story 8.5): after transitionCronState PAUSED_BY_CIRCUIT_BREAKER → ACTIVE,
 * the unblock route sets resolved_at = NOW() on the original circuit-breaker-trip audit_log row
 * for this cycle. This mirrors the anomaly-freeze resolved_at pattern (Story 7.4).
 *
 * @param {object} params
 * @param {object} params.tx - transaction-capable DB client (pg PoolClient with .query())
 * @param {string} params.customerMarketplaceId - UUID
 * @param {string} params.cycleId - UUID for this cycle
 * @param {Function} [params.sendAlertFn] - injectable for testing (default: _defaultSendAlertFn)
 *   Called with { customerMarketplaceId, cycleId, numerator, denominator } on trip.
 * @param {Function} [params.transitionCronStateFn] - injectable for testing (default: transitionCronState)
 * @returns {Promise<{ tripped: boolean, numerator: number, denominator: number, affectedPct: number }>}
 */
export async function checkPerCycleCircuitBreaker ({
  tx,
  customerMarketplaceId,
  cycleId,
  sendAlertFn = _defaultSendAlertFn,
  transitionCronStateFn = _transitionCronState,
}) {
  // Numerator: staged rows for this cycle not yet flushed (worker-must-filter-by-customer: include cm_id)
  const { rows: numRows } = await tx.query(
    'SELECT COUNT(*)::int AS count FROM pri01_staging WHERE cycle_id = $1 AND flushed_at IS NULL AND customer_marketplace_id = $2',
    [cycleId, customerMarketplaceId],
  );
  const numerator = numRows[0].count;

  // Denominator (F6): full active-SKU count for this marketplace
  const { rows: denRows } = await tx.query(
    'SELECT COUNT(*)::int AS count FROM sku_channels WHERE customer_marketplace_id = $1 AND excluded_at IS NULL',
    [customerMarketplaceId],
  );
  const denominator = denRows[0].count;

  // Guard: no active SKUs → cannot trip (affectedPct = 0)
  if (denominator === 0) {
    logger.debug({ customerMarketplaceId, cycleId }, 'circuit-breaker: per-cycle check skipped — no active SKUs');
    return { tripped: false, numerator, denominator, affectedPct: 0 };
  }

  const affectedPct = numerator / denominator;
  const tripped = affectedPct > 0.20;

  if (!tripped) {
    logger.debug(
      { customerMarketplaceId, cycleId, numerator, denominator, affectedPct },
      'circuit-breaker: per-cycle OK',
    );
    return { tripped: false, numerator, denominator, affectedPct };
  }

  // Per-cycle CB tripped — pause marketplace + send alert
  logger.warn(
    { customerMarketplaceId, cycleId, numerator, denominator, affectedPct },
    'circuit-breaker: per-cycle 20% tripped — pausing marketplace',
  );

  // transitionCronState atomically: UPDATE cron_state + emits circuit-breaker-trip Atenção event
  // (ACTIVE → PAUSED_BY_CIRCUIT_BREAKER is in per-transition event map in Story 4.1)
  // Do NOT call writeAuditEvent separately — transitionCronState already emits the event.
  await transitionCronStateFn({
    tx,
    customerMarketplaceId,
    from: 'ACTIVE',
    to: 'PAUSED_BY_CIRCUIT_BREAKER',
    context: { cycleId, numerator, denominator },
  });

  await sendAlertFn({
    customerMarketplaceId,
    cycleId,
    numerator,
    denominator,
  });

  return { tripped: true, numerator, denominator, affectedPct };
}
