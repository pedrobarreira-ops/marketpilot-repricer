// worker/src/engine/cooperative-absorb.js
// AD9 — Cooperative-ERP-sync detection and absorption.
// Called from worker/src/engine/decide.js STEP 2 (dynamic import stub).
//
// Detects when current_price_cents !== last_set_price_cents (ERP/external system
// updated the price on the Mirakl side without going through our PRI01 pipeline).
//
// Within tolerance (deviationPct <= threshold):
//   → absorb: update list_price to current as new baseline; emit Notável event.
// Above tolerance (deviationPct > threshold):
//   → freeze: set frozen_for_anomaly_review=true; emit Atenção event; Resend alert.
// In-flight import (pending_import_id IS NOT NULL):
//   → skip: current_price is in flux; not a stable signal.
//
// ESLint constraints enforced by this module:
//   - no-raw-INSERT-audit-log: never INSERT directly into audit_log
//   - no-default-export: only named exports
//   - no-float-price: deviationPct is a ratio (not a price), so the rule does not apply
//   - no-console: pino only (createWorkerLogger)

import { writeAuditEvent } from '../../../shared/audit/writer.js';
import { EVENT_TYPES } from '../../../shared/audit/event-types.js';
import { createWorkerLogger } from '../../../shared/logger.js';

const logger = createWorkerLogger();

// Default 40% anomaly threshold (per architecture pre-locked decision, AD9).
const DEFAULT_ANOMALY_THRESHOLD_PCT = 0.40;

/**
 * @typedef {Object} AbsorbResult
 * @property {boolean} absorbed - true when external change was absorbed as new baseline
 * @property {boolean} frozen  - true when deviation exceeded threshold and SKU was frozen
 * @property {boolean} [skipped] - true when pending_import_id was set (in-flight — skip signal)
 */

/**
 * Detect and handle an external price change (cooperative-ERP-sync, AD9).
 * Called from worker/src/engine/decide.js STEP 2.
 *
 * IMPORTANT: Mutates skuChannel.list_price_cents on absorption so that
 * decide.js STEP 3 computes floor/ceiling from the absorbed (new) list price.
 *
 * @param {object}        params
 * @param {object}        params.tx                  - transaction-capable DB client (must be active)
 * @param {object}        params.skuChannel           - sku_channels row (MUTATED on absorption: list_price_cents updated)
 * @param {object}        params.customerMarketplace  - customer_marketplaces row
 * @param {Function|null} [params.freezeFn]           - optional injected freeze function (for unit tests)
 * @returns {Promise<AbsorbResult>}
 */
export async function absorbExternalChange ({ tx, skuChannel, customerMarketplace, freezeFn = null }) {
  const {
    id: skuChannelId,
    sku_id: skuId,
    customer_marketplace_id: customerMarketplaceId,
  } = skuChannel;

  // ------------------------------------------------------------------
  // SKIP-ON-PENDING: in-flight PRI01 import means current_price is
  // not a stable signal — absorption must wait for PRI02 to settle.
  // Bundle C atomicity invariant (AD7).
  // ------------------------------------------------------------------
  if (skuChannel.pending_import_id !== null && skuChannel.pending_import_id !== undefined) {
    logger.debug({ skuChannelId }, 'cooperative-absorb: SKIP — pending_import_id set');
    return { absorbed: false, frozen: false, skipped: true };
  }

  // ------------------------------------------------------------------
  // NO-OP: price hasn't moved — no external change detected.
  // ------------------------------------------------------------------
  if (skuChannel.current_price_cents === skuChannel.last_set_price_cents) {
    logger.debug({ skuChannelId }, 'cooperative-absorb: no-op — current_price equals last_set_price');
    return { absorbed: false, frozen: false };
  }

  // ------------------------------------------------------------------
  // DEVIATION COMPUTATION (AD9)
  // Both operands are integer cents; division produces a float ratio.
  // This is NOT float-price math — it is a dimensionless ratio used for
  // threshold comparison only. The no-float-price ESLint rule does not
  // fire on identifiers named deviationPct (not price/floor/ceiling/etc).
  // ------------------------------------------------------------------
  const currentPriceCents    = skuChannel.current_price_cents;
  const listPriceCents       = skuChannel.list_price_cents;
  const previousListPriceCents = listPriceCents;

  const deviationPct = Math.abs((currentPriceCents - listPriceCents) / listPriceCents);
  const threshold    = customerMarketplace.anomaly_threshold_pct ?? DEFAULT_ANOMALY_THRESHOLD_PCT;

  logger.debug(
    { skuChannelId, deviationPct, threshold, currentPriceCents, listPriceCents },
    'cooperative-absorb: external change detected',
  );

  // ------------------------------------------------------------------
  // ABOVE THRESHOLD — anomaly freeze (calls Story 7.4 via stub/injection)
  // ------------------------------------------------------------------
  if (deviationPct > threshold) {
    logger.warn(
      { skuChannelId, deviationPct, threshold },
      'cooperative-absorb: deviation exceeds threshold — freezing SKU for anomaly review',
    );

    // Resolve freezeSkuForReview:
    //   - Use injected freezeFn when provided (unit tests inject a mock).
    //   - Fall back to dynamic import of Story 7.4 module; stub gracefully
    //     when Story 7.4 has not shipped yet (ERR_MODULE_NOT_FOUND).
    //   - Real runtime errors (DB failures, syntax errors in 7.4) MUST propagate.
    const doFreeze = freezeFn ?? await (async () => {
      let fn = async () => {
        logger.debug({ skuChannelId }, 'cooperative-absorb: anomaly-freeze stub (7.4 not shipped)');
      };
      try {
        const mod = await import('../safety/anomaly-freeze.js');
        fn = mod.freezeSkuForReview;
      } catch (err) {
        if (err && err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
      }
      return fn;
    })();

    await doFreeze({
      tx,
      skuChannelId,
      customerMarketplaceId,
      deviationPct,
      currentPriceCents,
      listPriceCents,
    });

    return { absorbed: false, frozen: true };
  }

  // ------------------------------------------------------------------
  // WITHIN THRESHOLD — absorb as new list_price baseline
  // ------------------------------------------------------------------

  // 1. Persist the updated list_price to the DB (within the caller's tx).
  await tx.query(
    'UPDATE sku_channels SET list_price_cents = $1 WHERE id = $2',
    [currentPriceCents, skuChannelId],
  );

  // 2. Emit the Notável audit event (priority derived by Story 9.1 DB trigger).
  //    Emitted BEFORE the in-memory mutation so that if the audit INSERT throws,
  //    the tx rolls back AND we leave skuChannel.list_price_cents unchanged —
  //    defence-in-depth against a caller that swallows the error and continues.
  await writeAuditEvent({
    tx,
    customerMarketplaceId,
    skuId,
    skuChannelId,
    eventType: EVENT_TYPES.EXTERNAL_CHANGE_ABSORBED,
    payload: {
      previousListPriceCents,
      newListPriceCents: currentPriceCents,
      deviationPct,
    },
  });

  // 3. Mutate the in-memory object so decide.js STEP 3 uses the new baseline
  //    when computing floor/ceiling (skuChannel.list_price_cents * (1 ± pct)).
  //    Safe: skuChannel is a local object constructed per-cycle by cycle-assembly.js.
  //    Done AFTER the audit INSERT so a tx-rolling-back failure leaves the
  //    in-memory object consistent with the DB state.
  skuChannel.list_price_cents = currentPriceCents;

  logger.info(
    { skuChannelId, previousListPriceCents, newListPriceCents: currentPriceCents, deviationPct },
    'cooperative-absorb: external change absorbed — new list_price baseline set',
  );

  return { absorbed: true, frozen: false };
}
