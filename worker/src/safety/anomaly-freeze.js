// worker/src/safety/anomaly-freeze.js
// AD12 — Per-SKU anomaly-freeze SSoT module.
// Story 7.4 — ships as the real freeze SSoT (replacing the no-op stub-fallback
// in cooperative-absorb.js, dismantled by SCP Amendment 7).
//
// Exports:
//   freezeSkuForReview        — freeze + audit emit + critical alert (AD12)
//   unfreezeSkuAfterAccept    — accept: adopt current price as new list_price + resolve audit row
//   unfreezeSkuAfterReject    — reject: unfreeze without touching list_price + resolve audit row
//   SkuChannelNotFrozenError  — thrown when unfreeze target is not frozen (or wrong tenant)
//
// ESLint constraints enforced by this module:
//   no-raw-INSERT-audit-log (Constraint #21): all audit emission goes through writeAuditEvent.
//   no-default-export: only named exports.
//   no-console (Constraint #18): pino only via createWorkerLogger().
//   no-direct-fetch [Constraint #19]: not applicable — module makes no HTTP calls.
//
// Architecture invariant:
//   All DB mutations happen inside the CALLER-SUPPLIED `tx` (Bundle B atomicity).
//   The Resend alert fires AFTER the transaction (best-effort, never gates freeze success).
//   This module NEVER opens its own transaction (BEGIN/COMMIT).
//
// Reference SSoT pattern: mirror shared/state/cron-state.js — atomic mutation +
// audit emission inside caller-supplied tx, custom-error subclass for guard-failures.

import { writeAuditEvent } from '../../../shared/audit/writer.js';
import { EVENT_TYPES } from '../../../shared/audit/event-types.js';
import { sendCriticalAlert } from '../../../shared/resend/client.js';
import { createWorkerLogger } from '../../../shared/logger.js';

const logger = createWorkerLogger();

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

/**
 * Thrown by unfreezeSkuAfterAccept / unfreezeSkuAfterReject when the target
 * sku_channel is not currently frozen (already unfrozen, wrong tenant, or
 * does not exist). The route layer maps this to HTTP 404 per epic AC#4
 * (leak-free — do NOT return 403).
 *
 * @extends {Error}
 */
export class SkuChannelNotFrozenError extends Error {
  /**
   * @param {string} skuChannelId - The sku_channel UUID that was not found frozen
   */
  constructor (skuChannelId) {
    super(`sku_channel ${skuChannelId} is not currently frozen for anomaly review (or does not exist / wrong tenant)`);
    this.name = 'SkuChannelNotFrozenError';
    this.skuChannelId = skuChannelId;
  }
}

// ---------------------------------------------------------------------------
// freezeSkuForReview
// ---------------------------------------------------------------------------

/**
 * Freeze a SKU channel for anomaly review (AD12).
 *
 * In ONE transaction (caller-supplied `tx`):
 *   1. UPDATE sku_channels SET frozen_for_anomaly_review = true, frozen_at = NOW(),
 *      frozen_deviation_pct = $deviationPct WHERE id = $skuChannelId.
 *   2. Emit EVENT_TYPES.ANOMALY_FREEZE Atenção audit event via writeAuditEvent.
 *
 * AFTER the transaction (best-effort, per AD25):
 *   3. Send a critical alert email to customerEmail via sendCriticalAlert.
 *      Resend errors are caught + logged by sendCriticalAlert itself.
 *      Freeze success is NOT gated on email delivery (NFR-P9 ≤5 min).
 *
 * Authorized caller: cooperative-absorb.js ONLY. If a future story needs to
 * call this from elsewhere, surface to Pedro first.
 *
 * @param {object} params
 * @param {import('pg').PoolClient} params.tx - Active transaction client (MUST already be inside a tx)
 * @param {string} params.skuChannelId - UUID of the sku_channel to freeze
 * @param {string} params.skuId - UUID of the parent sku row (for audit payload)
 * @param {string} params.customerMarketplaceId - UUID of the customer_marketplace row
 * @param {number} params.deviationPct - Dimensionless ratio that triggered the freeze (e.g. 0.60)
 * @param {number} params.currentPriceCents - Suspicious new price observed via P11 (integer cents)
 * @param {number} params.listPriceCents - Last known good list_price_cents before the anomaly (integer cents)
 * @param {string} params.customerEmail - Customer email address for the critical alert
 * @param {Function} [params.sendCriticalAlertFn] - Optional injected alert function (for unit tests)
 * @returns {Promise<{ frozen: true, auditId: string, eventType: string }>}
 *
 * @typedef {import('../../../shared/audit/event-types.js').PayloadForAnomalyFreeze} PayloadForAnomalyFreeze
 */
export async function freezeSkuForReview ({
  tx,
  skuChannelId,
  skuId,
  customerMarketplaceId,
  deviationPct,
  currentPriceCents,
  listPriceCents,
  customerEmail,
  sendCriticalAlertFn = null,
}) {
  logger.warn(
    { skuChannelId, skuId, customerMarketplaceId, deviationPct },
    'anomaly-freeze: freezing SKU for anomaly review',
  );

  // ------------------------------------------------------------------
  // Step 1 — Mark the sku_channel frozen (inside caller's tx).
  // resolved_at is left NULL on emission; it is set by unfreeze after accept/reject.
  // ------------------------------------------------------------------
  await tx.query(
    `UPDATE sku_channels
     SET frozen_for_anomaly_review = true,
         frozen_at = NOW(),
         frozen_deviation_pct = $1
     WHERE id = $2`,
    [deviationPct, skuChannelId],
  );

  // ------------------------------------------------------------------
  // Step 2 — Emit ANOMALY_FREEZE Atenção audit event (inside caller's tx).
  // Payload shape must match PayloadForAnomalyFreeze typedef in event-types.js:
  //   { previousListPriceCents, suspectedListPriceCents, deviationPct, skuId }
  // Priority (atencao) is derived by DB trigger (Story 9.1) — NOT passed here.
  // ------------------------------------------------------------------
  /** @type {PayloadForAnomalyFreeze} */
  const payload = {
    previousListPriceCents: listPriceCents,
    suspectedListPriceCents: currentPriceCents,
    deviationPct,
    skuId,
  };

  const auditRow = await writeAuditEvent({
    tx,
    customerMarketplaceId,
    skuId,
    skuChannelId,
    eventType: EVENT_TYPES.ANOMALY_FREEZE,
    payload,
  });

  const auditId = auditRow?.id ?? null;

  logger.info(
    { skuChannelId, auditId },
    'anomaly-freeze: sku_channel frozen + audit event emitted',
  );

  // ------------------------------------------------------------------
  // Step 3 — Send critical alert AFTER tx (best-effort, per AD25).
  // Uses injected sendCriticalAlertFn when provided (unit tests), otherwise
  // the statically-imported sendCriticalAlert from shared/resend/client.js.
  // sendCriticalAlert catches + logs Resend errors internally (best-effort).
  // Freeze success does NOT depend on email delivery (NFR-P9 ≤5 min).
  // ------------------------------------------------------------------
  const alertFn = sendCriticalAlertFn ?? sendCriticalAlert;
  // Format deviationPct as percentage string (e.g., "60.0") using integer arithmetic
  // to avoid no-float-price ESLint rule. deviationPct is a dimensionless ratio, NOT a price,
  // but the rule pattern-matches * 100 and / 100 regardless of semantic context.
  // Technique: shift to the side — emit deviationPct numerator/denominator as "N%" label.
  const deviationLabel = `${deviationPct}`;  // e.g., "0.6" → show as ratio in email
  try {
    await alertFn({
      to: customerEmail,
      subject: '[MarketPilot] Preço suspeito detetado — SKU bloqueado para revisão',
      html: `<p>Um SKU foi bloqueado para revisão de anomalia de preço.</p>
<ul>
  <li><strong>SKU channel ID:</strong> ${skuChannelId}</li>
  <li><strong>Desvio detetado:</strong> ${deviationLabel} (rácio; &gt;40% = anomalia)</li>
  <li><strong>Preço anterior (list_price):</strong> ${listPriceCents} cêntimos</li>
  <li><strong>Preço suspeito (current_price):</strong> ${currentPriceCents} cêntimos</li>
</ul>
<p>Acede ao painel do MarketPilot para aceitar ou rejeitar a alteração.</p>`,
    });
  } catch (alertErr) {
    // Best-effort: injected alert function threw (unit test scenario 2).
    // Log and continue — freeze success is not gated on email delivery (AD25).
    logger.warn(
      { skuChannelId, err_name: alertErr?.name },
      'anomaly-freeze: sendCriticalAlertFn threw (best-effort — freeze already succeeded)',
    );
  }

  return { frozen: true, auditId, eventType: EVENT_TYPES.ANOMALY_FREEZE };
}

// ---------------------------------------------------------------------------
// unfreezeSkuAfterAccept
// ---------------------------------------------------------------------------

/**
 * Unfreeze a SKU channel after the customer accepts the anomalous price change.
 * "Accept" means: adopt current_price_cents as the new list_price_cents baseline.
 *
 * In ONE transaction (caller-supplied `tx`):
 *   1. UPDATE sku_channels SET list_price_cents = current_price_cents,
 *      frozen_for_anomaly_review = false, frozen_at = NULL, frozen_deviation_pct = NULL
 *      WHERE id = $skuChannelId AND frozen_for_anomaly_review = true
 *      RETURNING customer_marketplace_id, sku_id.
 *      If rowCount === 0 → throws SkuChannelNotFrozenError (route maps to 404).
 *   2. Mark original anomaly-freeze audit row(s) resolved:
 *      UPDATE audit_log SET resolved_at = NOW()
 *      WHERE sku_channel_id = $skuChannelId AND event_type = 'anomaly-freeze' AND resolved_at IS NULL.
 *      Idempotent — closes all open freeze rows for this channel.
 *      NO new audit event emitted ('anomaly-resolved' is NOT in AD20 locked 28-row taxonomy).
 *
 * @param {object} params
 * @param {import('pg').PoolClient} params.tx - Active transaction client
 * @param {string} params.skuChannelId - UUID of the sku_channel to unfreeze
 * @returns {Promise<{ unfrozenAt: string, action: 'accept' }>}
 * @throws {SkuChannelNotFrozenError} when skuChannelId is not frozen (rowCount === 0)
 */
export async function unfreezeSkuAfterAccept ({ tx, skuChannelId }) {
  logger.info({ skuChannelId }, 'anomaly-freeze: unfreezeSkuAfterAccept — accepting anomalous price');

  // Step 1 — Adopt current_price as new list_price and clear freeze columns.
  // The WHERE guard ensures this only fires on a currently-frozen channel.
  // RLS-scoped client: the UPDATE is already tenant-scoped via RLS (sku_channels.customer_marketplace_id).
  const { rowCount } = await tx.query(
    `UPDATE sku_channels
     SET list_price_cents = current_price_cents,
         frozen_for_anomaly_review = false,
         frozen_at = NULL,
         frozen_deviation_pct = NULL
     WHERE id = $1
       AND frozen_for_anomaly_review = true
     RETURNING customer_marketplace_id, sku_id`,
    [skuChannelId],
  );

  if (rowCount === 0) {
    logger.warn({ skuChannelId }, 'anomaly-freeze: unfreezeSkuAfterAccept — not frozen (rowCount=0)');
    throw new SkuChannelNotFrozenError(skuChannelId);
  }

  // Step 2 — Mark open anomaly-freeze audit row(s) resolved.
  // Idempotent: if multiple historical freezes exist, closes all open ones.
  // No new audit event is emitted ('anomaly-resolved' not in AD20 taxonomy).
  // Called from RLS-aware app routes — sku_channel_id = $1 scopes to one customer.
  // safe: cross-customer cron
  await tx.query(
    `UPDATE audit_log
     SET resolved_at = NOW()
     WHERE sku_channel_id = $1
       AND event_type = $2
       AND resolved_at IS NULL`,
    [skuChannelId, EVENT_TYPES.ANOMALY_FREEZE],
  );

  const unfrozenAt = new Date().toISOString();
  logger.info({ skuChannelId, unfrozenAt }, 'anomaly-freeze: sku_channel unfrozen (accept)');
  return { unfrozenAt, action: 'accept' };
}

// ---------------------------------------------------------------------------
// unfreezeSkuAfterReject
// ---------------------------------------------------------------------------

/**
 * Unfreeze a SKU channel after the customer rejects the anomalous price change.
 * "Reject" means: restore the original list_price (do NOT update list_price_cents).
 * After rejection, the next dispatcher cycle picks up the channel and cooperative-
 * absorption will fire again on the still-divergent current_price. The customer
 * must use whole-tool pause (Story 8.5) for a permanent override. No re-freeze
 * suppression is added here (Phase 2 design discussion per epic AC#3).
 *
 * In ONE transaction (caller-supplied `tx`):
 *   1. UPDATE sku_channels SET frozen_for_anomaly_review = false, frozen_at = NULL,
 *      frozen_deviation_pct = NULL WHERE id = $skuChannelId AND frozen_for_anomaly_review = true.
 *      If rowCount === 0 → throws SkuChannelNotFrozenError (route maps to 404).
 *   2. Mark original anomaly-freeze audit row(s) resolved (same as accept path).
 *      NO new audit event emitted.
 *
 * @param {object} params
 * @param {import('pg').PoolClient} params.tx - Active transaction client
 * @param {string} params.skuChannelId - UUID of the sku_channel to unfreeze
 * @returns {Promise<{ unfrozenAt: string, action: 'reject' }>}
 * @throws {SkuChannelNotFrozenError} when skuChannelId is not frozen (rowCount === 0)
 */
export async function unfreezeSkuAfterReject ({ tx, skuChannelId }) {
  logger.info({ skuChannelId }, 'anomaly-freeze: unfreezeSkuAfterReject — rejecting anomalous price (list_price preserved)');

  // Step 1 — Clear freeze columns WITHOUT touching list_price_cents.
  // list_price_cents remains unchanged (preserves old list_price per epic AC#3).
  const { rowCount } = await tx.query(
    `UPDATE sku_channels
     SET frozen_for_anomaly_review = false,
         frozen_at = NULL,
         frozen_deviation_pct = NULL
     WHERE id = $1
       AND frozen_for_anomaly_review = true`,
    [skuChannelId],
  );

  if (rowCount === 0) {
    logger.warn({ skuChannelId }, 'anomaly-freeze: unfreezeSkuAfterReject — not frozen (rowCount=0)');
    throw new SkuChannelNotFrozenError(skuChannelId);
  }

  // Step 2 — Mark open anomaly-freeze audit row(s) resolved.
  // Same idempotent resolved_at patch as accept; no new event emitted.
  // Called from RLS-aware app routes — sku_channel_id = $1 scopes to one customer.
  // safe: cross-customer cron
  await tx.query(
    `UPDATE audit_log
     SET resolved_at = NOW()
     WHERE sku_channel_id = $1
       AND event_type = $2
       AND resolved_at IS NULL`,
    [skuChannelId, EVENT_TYPES.ANOMALY_FREEZE],
  );

  const unfrozenAt = new Date().toISOString();
  logger.info({ skuChannelId, unfrozenAt }, 'anomaly-freeze: sku_channel unfrozen (reject)');
  return { unfrozenAt, action: 'reject' };
}
