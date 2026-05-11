// worker/src/cycle-assembly.js
//
// Story 5.2: cycle-assembly skeleton — Atomicity Bundle C participant.
// Story 7.2: Updated to load full skuChannel row, customerMarketplace row, and P11 offers
//            when calling the real engine (decideForSkuChannel named-param shape).
// Story 7.6: Wire in real per-cycle circuit-breaker (checkPerCycleCircuitBreaker) and
//            per-SKU CB event emission when engine returns reason === 'circuit-breaker'.
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
import { EVENT_TYPES } from '../../shared/audit/event-types.js';
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
 * @param {Array<object>} skuChannels — rows from dispatcher SELECT (minimal shape from dispatcher query)
 * @param {string} cycleId — UUID minted by dispatchCycle at cycle start
 * @param {object} [opts] — injectable dependencies for testing:
 *   - engine: { decideForSkuChannel(params): Promise<{action, newPriceCents, auditEvents}> }
 *   - writeAuditEvent: function (same contract as shared/audit/writer.js)
 *   - circuitBreakerCheck: async (stagedCount) => void (injectable; defaults to real per-cycle CB via Story 7.6)
 *   - apiKey: string — decrypted Mirakl API key (required for real engine P11 calls)
 *   - baseUrl: string — Mirakl marketplace base URL (required for real engine P11 calls)
 * @returns {Promise<{ stagedCount: number, heldCount: number }>}
 */
export async function assembleCycle (tx, customerMarketplaceId, skuChannels, cycleId, opts = {}) {
  // Resolve engine: use injected engine if provided, else try to load real engine,
  // fall back to HOLD stub if Epic 7 engine has not yet shipped.
  const injectedEngine = opts.engine ?? null;
  const engine = injectedEngine ?? await (async () => {
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

  // Resolve circuit-breaker check: use injected stub or the real per-cycle CB (Story 7.6).
  // The default implementation loads checkPerCycleCircuitBreaker lazily (dynamic import) and
  // calls it with the current tx, customerMarketplaceId, and cycleId from this closure.
  // Tests inject opts.circuitBreakerCheck to avoid real DB/Resend calls.
  const circuitBreakerCheck = opts.circuitBreakerCheck ?? (async (_stagedCount) => {
    const cbMod = await import('./safety/circuit-breaker.js');
    return cbMod.checkPerCycleCircuitBreaker({
      tx,
      customerMarketplaceId,
      cycleId,
    });
  });

  // When using the real engine (not an injected test stub), load full context per SKU.
  // getProductOffersByEan is only imported for the real engine path; tests inject
  // opts.engine and bypass this block entirely.
  let getProductOffersByEan;
  let customerMarketplace;

  if (injectedEngine === null && opts.apiKey && opts.baseUrl) {
    // Load P11 wrapper for real engine calls
    const p11Mod = await import('../../shared/mirakl/p11.js');
    getProductOffersByEan = p11Mod.getProductOffersByEan;

    // Load the customer_marketplace row (needed for edge_step_cents, max_discount_pct, etc.)
    const { rows: cmRows } = await tx.query(
      'SELECT * FROM customer_marketplaces WHERE id = $1 LIMIT 1',
      [customerMarketplaceId],
    );
    customerMarketplace = cmRows[0] ?? null;
  }

  let stagedCount = 0;
  let heldCount = 0;

  for (const dispatcherRow of skuChannels) {
    // Determine which skuChannel and call params to use based on engine mode.
    // For injected test engines: pass the dispatcher row directly (mocks ignore it).
    // For the real engine: load full sku_channels row and full context.
    let skuChannel = dispatcherRow;
    let decideParams;

    if (injectedEngine !== null) {
      // Test mode: injected engine; pass dispatcher row + minimal context (mock ignores args)
      decideParams = { skuChannel: dispatcherRow, customerMarketplace: null, ownShopName: null, p11RawOffers: [], tx };
    } else if (getProductOffersByEan && customerMarketplace) {
      // Real engine mode: load full sku_channels row + sku row for EAN + fetch P11 offers
      const { rows: scRows } = await tx.query(
        'SELECT sc.*, s.ean FROM sku_channels sc JOIN skus s ON s.id = sc.sku_id WHERE sc.id = $1 LIMIT 1',
        [dispatcherRow.id],
      );
      if (scRows.length === 0) {
        logger.warn({ skuChannelId: dispatcherRow.id }, 'cycle-assembly: skuChannel row not found — skipping');
        heldCount++;
        continue;
      }
      skuChannel = scRows[0];

      const p11RawOffers = await getProductOffersByEan(opts.baseUrl, opts.apiKey, {
        ean: skuChannel.ean,
        channel: skuChannel.channel_code,
        pricingChannelCode: skuChannel.channel_code,
      });

      decideParams = {
        skuChannel,
        customerMarketplace,
        ownShopName: customerMarketplace.shop_name,
        p11RawOffers,
        tx,
      };
    } else {
      // Real engine mode but missing apiKey/baseUrl opts — log and skip (misconfiguration)
      logger.warn({ skuChannelId: dispatcherRow.id, customerMarketplaceId }, 'cycle-assembly: real engine mode but apiKey/baseUrl not provided — skipping SKU');
      heldCount++;
      continue;
    }

    const { action, newPriceCents, auditEvents, reason } = await engine.decideForSkuChannel(decideParams);

    // Per-SKU circuit-breaker trip — decide.js returns { action:'HOLD', auditEvents:[], reason:'circuit-breaker' }.
    // cycle-assembly is responsible for emitting the CIRCUIT_BREAKER_PER_SKU_TRIP Atenção event
    // and sending the Resend critical alert (checkPerSkuCircuitBreaker is pure; no side effects there).
    if (action === 'HOLD' && reason === 'circuit-breaker') {
      await writeAuditEvent({
        tx,
        customerMarketplaceId,
        skuId: skuChannel.sku_id,
        skuChannelId: skuChannel.id,
        cycleId,
        eventType: EVENT_TYPES.CIRCUIT_BREAKER_PER_SKU_TRIP,
        payload: {
          skuId: skuChannel.sku_id,
          failureCount: 1, // per-SKU CB always fires on first occurrence
          cycleId,
        },
      });
      // Send Resend critical alert for per-SKU trip (best-effort; sendCriticalAlert never re-throws)
      // Lazy import to avoid pulling in RESEND_API_KEY check at module load time
      const { sendCriticalAlert } = await import('../../shared/resend/client.js');
      await sendCriticalAlert({
        to: process.env.ALERT_EMAIL ?? 'alerts@marketpilot.pt',
        subject: '[MarketPilot] Per-SKU circuit breaker tripped',
        html: `<p>Per-SKU circuit breaker tripped (>15% price move).</p>
<ul>
  <li><strong>Customer marketplace:</strong> ${customerMarketplaceId}</li>
  <li><strong>SKU channel ID:</strong> ${skuChannel.id}</li>
  <li><strong>Cycle ID:</strong> ${cycleId}</li>
</ul>`,
      });
      heldCount++;
      continue;
    }

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
      // HOLD or SKIP (or any other non-write action) — no staging row
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
