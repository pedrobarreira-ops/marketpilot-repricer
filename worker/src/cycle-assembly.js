// worker/src/cycle-assembly.js
//
// Story 5.2: cycle-assembly skeleton — Atomicity Bundle C participant.
//
// Bridges the dispatcher (Story 5.1) and the pricing engine (Epic 7).
// Reads per-SKU decisions from the engine, writes UNDERCUT/CEILING_RAISE
// decisions to pri01_staging, skips HOLD decisions, and emits an audit event
// for every decision.
//
// The real engine (worker/src/engine/decide.js) ships in Epic 7. Until then,
// the engine is resolved via a dynamic import with a HOLD fallback stub.
//
// Architecture constraints:
//   - No Redis / BullMQ / external queue (constraint #8)
//   - No raw INSERT INTO audit_log outside shared/audit/writer.js (constraint #21)
//   - worker-must-filter-by-customer: INSERT includes customer_marketplace_id (constraint #24)
//   - No console.log — pino logger only (constraint #18)
//   - No default exports (constraint enforced by ESLint)
//   - No .then() chains — async/await only

import { writeAuditEvent as _writeAuditEvent } from '../../shared/audit/writer.js';
import { createWorkerLogger } from '../../shared/logger.js';

const logger = createWorkerLogger();

/**
 * Assemble one pricing cycle for a single customer's SKU-channels.
 * Writes UNDERCUT/CEILING_RAISE decisions to pri01_staging.
 * HOLD decisions emit an audit event but produce no staging row.
 * At batch end, calls circuitBreakerCheck (stub; Story 7.6 fills in).
 *
 * @param {object} tx — transaction-capable DB client (from Story 2.1 tx helper)
 * @param {string} customerMarketplaceId — UUID
 * @param {Array<object>} skuChannels — rows from dispatcher SELECT
 * @param {string} cycleId — UUID minted by dispatchCycle at cycle start
 * @param {object} [opts] — injectable dependencies for testing:
 *   - engine: { decideForSkuChannel(skuChannel, context): Promise<{action, newPriceCents, auditEvents}> }
 *   - writeAuditEvent: function (same contract as shared/audit/writer.js)
 *   - circuitBreakerCheck: async (stagedCount) => void (stub; Story 7.6)
 * @returns {Promise<{ stagedCount: number, heldCount: number }>}
 */
export async function assembleCycle (tx, customerMarketplaceId, skuChannels, cycleId, opts = {}) {
  // Resolve engine: use injected engine if provided, else try to load real engine,
  // fall back to HOLD stub if Epic 7 engine has not yet shipped.
  const engine = opts.engine ?? await (async () => {
    try {
      const { decideForSkuChannel } = await import('./engine/decide.js');
      return { decideForSkuChannel };
    } catch {
      return {
        decideForSkuChannel: async () => ({
          action: 'HOLD',
          newPriceCents: null,
          auditEvents: ['hold-already-in-1st'],
        }),
      };
    }
  })();

  // Resolve writeAuditEvent: use injected stub or the shared SSoT writer
  const writeAuditEvent = opts.writeAuditEvent ?? _writeAuditEvent;

  // Resolve circuit-breaker check: use injected stub or default log-only stub
  const circuitBreakerCheck = opts.circuitBreakerCheck ?? (async (stagedCount) => {
    logger.debug(
      { stagedCount, cycleId, customerMarketplaceId },
      'cycle-assembly: circuit-breaker check (stub — Story 7.6)',
    );
  });

  let stagedCount = 0;
  let heldCount = 0;

  for (const skuChannel of skuChannels) {
    const { action, newPriceCents, auditEvents } = await engine.decideForSkuChannel(
      skuChannel,
      { customerMarketplaceId, cycleId },
    );

    if (action === 'UNDERCUT' || action === 'CEILING_RAISE') {
      // Insert one staging row for this pricing decision
      await tx.query(
        `INSERT INTO pri01_staging
           (customer_marketplace_id, sku_id, channel_code, new_price_cents, cycle_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [customerMarketplaceId, skuChannel.sku_id, skuChannel.channel_code, newPriceCents, cycleId],
      );
      stagedCount++;
    } else {
      // HOLD (or any other non-write action) — no staging row
      heldCount++;
    }

    // Emit one audit event per decision event type returned by the engine
    for (const eventType of auditEvents) {
      await writeAuditEvent({
        tx,
        customerMarketplaceId,
        skuId: skuChannel.sku_id,
        skuChannelId: skuChannel.id,
        cycleId,
        eventType,
        payload: { action, newPriceCents },
      });
    }
  }

  // Circuit-breaker check at end of batch (Story 7.6 fills in the real check)
  await circuitBreakerCheck(stagedCount);

  return { stagedCount, heldCount };
}
