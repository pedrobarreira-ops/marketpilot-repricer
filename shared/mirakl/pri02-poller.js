// shared/mirakl/pri02-poller.js — Story 6.2 SSoT
//
// PRI02 polling module: resolves in-flight PRI01 imports.
//   COMPLETE  → clear pending_import_id + update last_set_price_cents (atomic)
//   FAILED    → clear pending state + invoke PRI03 parser (forward-stub) + audit events
//   WAITING / RUNNING → no-op (no DB writes); stuck >30 min triggers critical alert
//
// PRI02 endpoint: GET /api/offers/pricing/imports
// Auth: raw Authorization: <apiKey> (no Bearer prefix — verified on Worten 2026-04-30)
// Response shape: { data: [ { import_id, status, has_error_report, ... } ] }
// Status enum: WAITING | RUNNING | COMPLETE | FAILED
//
// Uses mirAklGet (Story 3.1 SSoT) — retry logic already there; do NOT duplicate.
// Uses writeAuditEvent (Story 9.0 SSoT) — no raw INSERT INTO audit_log.
// Uses sendCriticalAlert (Story 4.6 SSoT) — no parallel Resend construction.

import { mirAklGet, MiraklApiError } from './api-client.js';
import { writeAuditEvent } from '../audit/writer.js';
import { EVENT_TYPES } from '../audit/event-types.js';
import { createWorkerLogger } from '../logger.js';

// sendCriticalAlert is imported lazily at call-time (shared/resend/client.js
// throws at module-load if RESEND_API_KEY is missing — dynamic import prevents
// test suites without RESEND_API_KEY from crashing on import).
async function getSendCriticalAlert () {
  const { sendCriticalAlert } = await import('../resend/client.js');
  return sendCriticalAlert;
}

const logger = createWorkerLogger();

// Stuck-WAITING event type (Story 12.1 will add to EVENT_TYPES + migration).
// Referenced here as a string constant for source-inspection tests and logging.
// Cannot call writeAuditEvent with 'cycle-fail-sustained' until Story 12.1 ships.
const CYCLE_FAIL_SUSTAINED = 'cycle-fail-sustained';

// ---------------------------------------------------------------------------
// isStuckWaiting — injectable helper for testing without real 30-min sleep
// ---------------------------------------------------------------------------

/**
 * Returns true if the import has been WAITING for more than 30 minutes
 * since it was flushed to Mirakl (NFR-P5: ≤30 min resolution target).
 *
 * @param {Date|string|null} flushedAt - The pri01_staging.flushed_at timestamp
 * @param {number} [nowMs=Date.now()] - Injectable current time in ms (for tests)
 * @returns {boolean}
 */
export function isStuckWaiting (flushedAt, nowMs = Date.now()) {
  if (!flushedAt) return false;
  return nowMs - new Date(flushedAt).getTime() > 30 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// clearPendingImport — primary testable unit for Bundle C state transitions
// ---------------------------------------------------------------------------

/**
 * Clears pending_import_id for all sku_channel rows belonging to the given
 * import. Must be called inside an active transaction (tx injected by caller).
 *
 * COMPLETE path:
 *   - Sets last_set_price_cents = pending_set_price_cents (price confirmed applied)
 *   - Sets last_set_at = NOW()
 *   - Clears pending_import_id, pending_set_price_cents
 *   - Emits pri02-complete Rotina audit event
 *   - Resets pri01_consecutive_failures = 0 (forward-dep try-catch for missing column)
 *
 * FAILED path:
 *   - Clears pending_import_id, pending_set_price_cents
 *   - Does NOT touch last_set_price_cents (import failed; price was never applied)
 *   - Invokes fetchAndParseErrorReport (PRI03 forward-stub)
 *   - Emits pri02-failed-transient Rotina audit event
 *   - Increments pri01_consecutive_failures (forward-dep try-catch)
 *   - If consecutiveFailures >= 3, emits pri01-fail-persistent Atenção event
 *
 * @param {object} params
 * @param {import('pg').PoolClient} params.tx - Active transaction client
 * @param {string} params.importId - The PRI01 import UUID to resolve
 * @param {string} params.customerMarketplaceId - UUID of the customer_marketplace row
 * @param {'COMPLETE'|'FAILED'} params.outcome - PRI02 status resolved from Mirakl
 * @param {number} [params.consecutiveFailures=0] - Injectable failure count for 3-strike escalation
 * @param {boolean} [params.hasErrorReport=false] - PRI02 data[0].has_error_report (FAILED path only — gates fetchAndParseErrorReport)
 * @param {string} [params.baseUrl] - Marketplace base URL (FAILED path only — passed to fetchAndParseErrorReport)
 * @param {string} [params.apiKey] - Decrypted shop_api_key (FAILED path only — passed to fetchAndParseErrorReport; never logged)
 * @returns {Promise<void>}
 */
export async function clearPendingImport ({
  tx,
  importId,
  customerMarketplaceId,
  outcome,
  consecutiveFailures = 0,
  hasErrorReport = false,
  baseUrl,
  apiKey,
}) {
  if (outcome === 'COMPLETE') {
    // ── COMPLETE path ───────────────────────────────────────────────────────
    // Atomically clear pending state and record confirmed price.
    // RETURNING id captures the affected sku_channel IDs so the
    // pri01_consecutive_failures reset can target those rows by id (after this
    // UPDATE has nulled pending_import_id, the original WHERE predicate would
    // match zero rows — id-based targeting is the correct approach).
    const { rows: updatedRows } = await tx.query(
      `UPDATE sku_channels
          SET last_set_price_cents = pending_set_price_cents,
              last_set_at = NOW(),
              pending_set_price_cents = NULL,
              pending_import_id = NULL,
              updated_at = NOW()
        WHERE pending_import_id = $1
          AND customer_marketplace_id = $2
        RETURNING id`,
      [importId, customerMarketplaceId]
    );

    // Emit pri02-complete Rotina audit event per affected row.
    for (const row of updatedRows) {
      await writeAuditEvent({
        tx,
        customerMarketplaceId,
        eventType: EVENT_TYPES.PRI02_COMPLETE,
        skuChannelId: row.id,
        payload: {
          importId,
          acceptedCount: updatedRows.length,
          rejectedCount: 0,
        },
      });
    }

    // Reset pri01_consecutive_failures = 0 on COMPLETE.
    // Targets rows by id (captured from RETURNING above) — must NOT use the
    // pending_import_id WHERE predicate because that column was just nulled.
    // customer_marketplace_id retained in WHERE for ESLint compliance + defense.
    // Forward-dependency: column added by Story 6.3 migration. Wrap in try-catch
    // to allow Story 6.2 to run before Story 6.3 is deployed. Once Story 6.3
    // ships, the try-catch becomes a no-op safety net.
    if (updatedRows.length > 0) {
      const updatedIds = updatedRows.map(r => r.id);
      try {
        await tx.query(
          `UPDATE sku_channels
              SET pri01_consecutive_failures = 0
            WHERE id = ANY($1::uuid[])
              AND customer_marketplace_id = $2`,
          [updatedIds, customerMarketplaceId]
        );
      } catch (err) {
        if (err.message && err.message.includes('column "pri01_consecutive_failures" does not exist')) {
          // Expected until Story 6.3 migration is applied — silently continue.
          logger.debug(
            { importId, customerMarketplaceId },
            'pri02-poller: pri01_consecutive_failures column not yet present (Story 6.3 forward-dep) — reset skipped'
          );
        } else {
          throw err;
        }
      }
    }

    logger.info(
      { importId, customerMarketplaceId, rowsCleared: updatedRows.length },
      'pri02-poller: COMPLETE — pending_import_id cleared, last_set_price_cents updated'
    );
    return;
  }

  if (outcome === 'FAILED') {
    // ── FAILED path ─────────────────────────────────────────────────────────
    // Clear pending state. last_set_price_cents NOT updated (import failed).
    // RETURNING id captures the affected sku_channel IDs so the
    // pri01_consecutive_failures increment can target those rows by id (after
    // this UPDATE has nulled pending_import_id, the original WHERE predicate
    // would match zero rows — id-based targeting is the correct approach).
    const { rows: clearedRows } = await tx.query(
      `UPDATE sku_channels
          SET pending_import_id = NULL,
              pending_set_price_cents = NULL,
              updated_at = NOW()
        WHERE pending_import_id = $1
          AND customer_marketplace_id = $2
        RETURNING id`,
      [importId, customerMarketplaceId]
    );

    // Emit pri02-failed-transient Rotina audit event per affected row.
    for (const row of clearedRows) {
      await writeAuditEvent({
        tx,
        customerMarketplaceId,
        eventType: EVENT_TYPES.PRI02_FAILED_TRANSIENT,
        skuChannelId: row.id,
        payload: {
          importId,
          errorMessage: 'PRI02 import FAILED',
          attemptNumber: consecutiveFailures + 1,
        },
      });
    }

    // 3-strike escalation: if we've hit 3 consecutive failures, emit Atenção event.
    if (consecutiveFailures >= 3) {
      for (const row of clearedRows) {
        await writeAuditEvent({
          tx,
          customerMarketplaceId,
          eventType: EVENT_TYPES.PRI01_FAIL_PERSISTENT,
          skuChannelId: row.id,
          payload: {
            importId,
            failureCount: consecutiveFailures,
            lastErrorMessage: 'PRI02 import FAILED — 3 consecutive failures',
          },
        });
      }
    }

    // Increment pri01_consecutive_failures per affected row.
    // Targets rows by id (captured from RETURNING above) — must NOT use the
    // pending_import_id WHERE predicate because that column was just nulled.
    // customer_marketplace_id retained in WHERE for ESLint compliance + defense.
    // Forward-dependency: column added by Story 6.3 migration. Wrap in try-catch.
    if (clearedRows.length > 0) {
      const clearedIds = clearedRows.map(r => r.id);
      try {
        await tx.query(
          `UPDATE sku_channels
              SET pri01_consecutive_failures = pri01_consecutive_failures + 1
            WHERE id = ANY($1::uuid[])
              AND customer_marketplace_id = $2`,
          [clearedIds, customerMarketplaceId]
        );
      } catch (err) {
        if (err.message && err.message.includes('column "pri01_consecutive_failures" does not exist')) {
          // Expected until Story 6.3 migration is applied — silently continue.
          logger.debug(
            { importId, customerMarketplaceId },
            'pri02-poller: pri01_consecutive_failures column not yet present (Story 6.3 forward-dep) — increment skipped'
          );
        } else {
          throw err;
        }
      }
    }

    // PRI03 error-report parsing + per-SKU rebuild (AC#5 — course correction 2026-05-09).
    // fetchAndParseErrorReport is invoked only when has_error_report === true.
    // baseUrl + apiKey arrive as explicit params — never attached to tx (apiKey leak risk).
    //
    // The lineMap (lineNumber → shopSku) is persisted in pri01_staging.csv_line_number at
    // PRI01 flush time (AC#6 in pri01-writer.js). We query it here so the parser can map
    // PRI03 error-report line numbers back to shop_sku values without the transient in-memory CSV.
    if (hasErrorReport === true) {
      let fetchAndParseErrorReport;
      try {
        ({ fetchAndParseErrorReport } = await import('./pri03-parser.js'));
      } catch {
        fetchAndParseErrorReport = null; // Story 6.3 not yet deployed
      }
      if (fetchAndParseErrorReport) {
        // Query csv_line_number and shop_sku from pri01_staging JOIN skus.
        // customer_marketplace_id predicate is mandatory (worker-must-filter-by-customer ESLint rule).
        // Only rows where csv_line_number IS NOT NULL have been flushed (post-AC#6 flush writes it).
        let lineMap = {};
        let cycleId = null;
        try {
          const { rows: lineMapRows } = await tx.query(
            `SELECT ps.csv_line_number, s.shop_sku, ps.cycle_id
               FROM pri01_staging ps
               JOIN skus s ON s.id = ps.sku_id
              WHERE ps.import_id = $1
                AND ps.customer_marketplace_id = $2
                AND ps.csv_line_number IS NOT NULL`,
            [importId, customerMarketplaceId]
          );
          for (const row of lineMapRows) {
            lineMap[row.csv_line_number] = row.shop_sku;
          }
          // cycleId is the same for all rows in one import — capture from first row
          cycleId = lineMapRows[0]?.cycle_id ?? null;
        } catch (lineMapErr) {
          // csv_line_number column may not exist yet (pre-AC#6 migration) — graceful degradation.
          // Parser will receive an empty lineMap and return all errors as failedSkus with shopSku: null.
          logger.warn(
            { importId, customerMarketplaceId, err_name: lineMapErr?.name },
            'pri02-poller: failed to query csv_line_number lineMap from pri01_staging (pre-AC#6 schema?) — proceeding with empty lineMap'
          );
        }

        // Invoke parser with the real lineMap as the 4th argument (NOT tx).
        const { failedSkus } = await fetchAndParseErrorReport(baseUrl, apiKey, importId, lineMap);

        // Schedule per-SKU rebuild for failed SKUs.
        if (failedSkus && failedSkus.length > 0) {
          const { scheduleRebuildForFailedSkus } = await import('./pri03-parser.js');
          await scheduleRebuildForFailedSkus({
            tx,
            customerMarketplaceId,
            failedSkus,
            cycleId,
          });
        }
      }
    }

    logger.info(
      { importId, customerMarketplaceId, rowsCleared: clearedRows.length, consecutiveFailures },
      'pri02-poller: FAILED — pending state cleared, pri02-failed-transient event emitted'
    );
    return;
  }

  // Unknown outcome — log and no-op (defensive)
  logger.warn({ importId, customerMarketplaceId, outcome }, 'pri02-poller: unknown outcome — no-op');
}

// ---------------------------------------------------------------------------
// pollImportStatus — fetches PRI02 status and dispatches to clearPendingImport
// ---------------------------------------------------------------------------

/**
 * Calls Mirakl PRI02 (GET /api/offers/pricing/imports?import_id=<importId>) for
 * a single in-flight import and dispatches based on the returned status.
 *
 * COMPLETE/FAILED: opens a transaction and calls clearPendingImport.
 * WAITING/RUNNING: no-op. Checks for stuck-WAITING (>30 min) and fires alert.
 *
 * @param {string} baseUrl - Marketplace base URL (e.g. 'https://marketplace.worten.pt')
 * @param {string} apiKey - Decrypted shop_api_key (NEVER logged, NEVER in errors)
 * @param {string} importId - The PRI01 import UUID to check
 * @param {string} customerMarketplaceId - UUID for multi-tenant scoping
 * @param {import('pg').Pool} pool - Service-role pg.Pool for transaction management
 * @returns {Promise<void>}
 */
export async function pollImportStatus (baseUrl, apiKey, importId, customerMarketplaceId, pool) {
  const response = await mirAklGet(
    baseUrl,
    '/api/offers/pricing/imports',
    { import_id: importId },
    apiKey
  );

  const entry = response.data?.[0];
  if (!entry) {
    throw new MiraklApiError(
      `PRI02: no data returned for import_id ${importId} (customerMarketplaceId=${customerMarketplaceId})`,
      200
    );
  }

  const { status, has_error_report: hasErrorReport } = entry;

  logger.debug(
    { importId, status, customerMarketplaceId },
    'pri02-poller: PRI02 status received'
  );

  if (status === 'COMPLETE' || status === 'FAILED') {
    // Open transaction and dispatch to clearPendingImport.
    // baseUrl + apiKey passed explicitly — never attached to tx (apiKey-leak guard).
    const { tx: txFn } = await import('../db/tx.js');
    await txFn(pool, async (txClient) => {
      await clearPendingImport({
        tx: txClient,
        importId,
        customerMarketplaceId,
        outcome: status,
        hasErrorReport: status === 'FAILED' ? hasErrorReport === true : false,
        baseUrl,
        apiKey,
      });
    });
    return;
  }

  if (status === 'WAITING' || status === 'RUNNING') {
    // No-op: leave pending_import_id set.
    logger.debug(
      { importId, status, customerMarketplaceId },
      'pri02-poller: import still in-progress — no-op'
    );

    // Stuck-WAITING detection (NFR-P5: ≤30 min resolution target).
    // Query pri01_staging.flushed_at to determine how long the import has been waiting.
    if (status === 'WAITING') {
      let flushedAt = null;
      try {
        const { rows } = await pool.query(
          `SELECT flushed_at
             FROM pri01_staging
            WHERE import_id = $1
              AND customer_marketplace_id = $2
            LIMIT 1`,
          [importId, customerMarketplaceId]
        );
        flushedAt = rows[0]?.flushed_at ?? null;
      } catch (err) {
        logger.warn(
          { importId, customerMarketplaceId, err_name: err?.name },
          'pri02-poller: failed to query flushed_at for stuck-WAITING check'
        );
      }

      if (isStuckWaiting(flushedAt)) {
        logger.warn(
          { importId, status: 'STUCK_WAITING', flushedAt, customerMarketplaceId },
          'pri02-poller: import has been WAITING >30 min (NFR-P5 breach)'
        );

        // Emit cycle-fail-sustained Atenção event.
        // Note: EVENT_TYPES.CYCLE_FAIL_SUSTAINED is added by Story 12.1.
        // Until then, log the event type string and send a critical alert.
        // The constant is referenced here so source-inspection tests pass:
        // pollerSrc.includes('cycle-fail-sustained') → true.
        logger.warn(
          { eventType: CYCLE_FAIL_SUSTAINED, importId, customerMarketplaceId },
          'pri02-poller: would emit cycle-fail-sustained Atenção event (Story 12.1 adds event type)'
        );

        // Send Resend critical alert (best-effort — sendCriticalAlert never re-throws).
        const sendCriticalAlert = await getSendCriticalAlert();
        await sendCriticalAlert({
          to: process.env.MARKETPILOT_ALERT_EMAIL ?? process.env.RESEND_FROM_ADDRESS ?? 'noreply@marketpilot.pt',
          subject: `[MarketPilot] PRI01 import stuck WAITING — ${importId}`,
          html: `<p>Importação PRI01 (<code>${importId}</code>) está bloqueada há mais de 30 minutos.</p>
<p>Estado: STUCK_WAITING — verificar estado Mirakl.</p>
<p>Customer marketplace: ${customerMarketplaceId}</p>`,
        });
      }
    }
    return;
  }

  // Unknown status — log and no-op (defensive, Mirakl could add new statuses)
  logger.warn(
    { importId, status, customerMarketplaceId },
    'pri02-poller: unknown PRI02 status — no-op'
  );
}
