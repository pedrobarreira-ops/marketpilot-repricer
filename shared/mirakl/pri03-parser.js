// shared/mirakl/pri03-parser.js — AD7/AD24 SSoT (Story 6.3)
//
// PRI03 error-report parser: fetches the CSV error report for a failed PRI01 import,
// maps line numbers back to shop SKUs (via the lineMap from buildPri01Csv), and
// schedules per-SKU full-rebuild staging rows so the next dispatcher cycle retries
// the write with corrected full-SKU context.
//
// Two exports:
//   fetchAndParseErrorReport — GET /api/offers/pricing/imports/{import_id}/error_report
//   scheduleRebuildForFailedSkus — inserts pri01_staging rows + increments failure counter
//                                   + 3-strike escalation (freeze + Atenção + critical alert)
//
// PRI03 endpoint (MCP-verified 2026-05-08):
//   GET /api/offers/pricing/imports/{import_id}/error_report
//   Path-parameterised (NOT query param). Returns CSV: col 1 = line number, col 2 = error reason.
//   Auth: `Authorization: <apiKey>` (raw key, NO Bearer prefix — same pattern as PRI01/PRI02).
//   Lines absent from error report = successfully imported.
//
// Per-SKU rebuild semantics (Bundle C invariant):
//   A failed import means Mirakl applied NONE of the prices (not partial).
//   Therefore last_set_price_cents MUST NOT be modified.
//   Rebuild inserts a fresh pri01_staging row using ALL channels of the affected SKU
//   (not just the failed line) so the delete-and-replace semantic is safe on retry.
//
// Design choice AC#4 — freeze representation (Option b: parallel boolean):
//   frozen_for_pri01_persistent boolean NOT NULL DEFAULT false
//   This column is orthogonal to frozen_for_anomaly_review (no shared state, no overloading).
//   Migration: supabase/migrations/202604301215_add_pri01_consecutive_failures_to_sku_channels.sql
//
// sendCriticalAlert imported lazily (shared/resend/client.js throws at module-load
// if RESEND_API_KEY is missing — dynamic import prevents test suites without RESEND_API_KEY
// from crashing on import).

import { writeAuditEvent } from '../audit/writer.js';
import { EVENT_TYPES } from '../audit/event-types.js';
import { createWorkerLogger } from '../logger.js';

// ── Internal retry helpers (duplicated from api-client.js — NOT imported to
//    avoid forcing mirAklGet to handle CSV responses; refactor to
//    shared/mirakl/retry.js if a third module needs this). Same schedule as
//    pri01-writer.js (RETRY_DELAYS_MS [1s, 2s, 4s, 8s, 16s], MAX_RETRIES=5).
//    Retryable: 429 + 5xx + transport errors (status 0).
//    Non-retryable: other 4xx — fail immediately. ────────────────────────────

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const MAX_RETRIES = 5;

/**
 * @param {number} status - HTTP status code; 0 for transport errors
 * @returns {boolean}
 */
function isRetryable (status) {
  return status === 429 || status >= 500;
}

/**
 * @param {number} ms - delay in milliseconds; capped at 30 000 ms
 * @returns {Promise<void>}
 */
function backoffDelay (ms) {
  return new Promise(r => setTimeout(r, Math.min(ms, 30000)));
}

// PT-localized error code → message map for known PRI03 error codes.
// These are the codes returned by Mirakl in the CSV error report's second column.
// Any unknown code falls through to the default PT fallback.
const PRI03_ERROR_MESSAGES_PT = {
  SKU_NOT_FOUND: 'Artigo não encontrado no catálogo Mirakl.',
  SKU_NOT_FOUND_IN_CATALOG: 'Artigo não encontrado no catálogo do operador. Verifica se o EAN está correcto.',
  PRICE_TOO_LOW: 'Preço abaixo do mínimo permitido pelo operador.',
  PRICE_BELOW_FLOOR: 'Preço abaixo do preço mínimo (floor) configurado.',
  PRICE_TOO_HIGH: 'Preço acima do máximo permitido pelo operador.',
  INVALID_PRICE: 'Preço inválido — verifica o formato (casas decimais e separador).',
  CHANNEL_NOT_FOUND: 'Canal não encontrado para este artigo. Verifica o código de canal.',
  OFFER_NOT_FOUND: 'Oferta não encontrada no marketplace. O artigo pode ter sido retirado.',
  SHOP_NOT_FOUND: 'Loja não encontrada. Verifica as credenciais da conta Mirakl.',
  INACTIVE_OFFER: 'Oferta inactiva — não é possível actualizar o preço de um artigo inactivo.',
};

/** Default PT fallback for unrecognised error codes */
const DEFAULT_PT_ERROR = 'Erro ao processar preço para este artigo. Verifica os dados e tenta novamente.';

/**
 * Map a raw Mirakl PRI03 error reason string to a PT-localized user-safe message.
 *
 * Follows the getSafeErrorMessage pattern from Story 3.1 (shared/mirakl/safe-error.js)
 * but maps by error-code string rather than HTTP status code.
 *
 * @param {string} rawErrorCode - Raw error code from PRI03 CSV column 2
 * @returns {string} PT-localized message safe for display
 */
function localizeErrorCode (rawErrorCode) {
  const trimmed = (rawErrorCode ?? '').trim().toUpperCase();
  return PRI03_ERROR_MESSAGES_PT[trimmed] ?? DEFAULT_PT_ERROR;
}

// ---------------------------------------------------------------------------
// Lazy import for sendCriticalAlert
// ---------------------------------------------------------------------------

/**
 * Lazily import and return sendCriticalAlert from shared/resend/client.js.
 * Dynamic import prevents module-load crash in test suites without RESEND_API_KEY.
 *
 * @returns {Promise<Function>}
 */
async function getSendCriticalAlert () {
  const { sendCriticalAlert } = await import('../resend/client.js');
  return sendCriticalAlert;
}

const logger = createWorkerLogger();

// ---------------------------------------------------------------------------
// fetchAndParseErrorReport
// ---------------------------------------------------------------------------

/**
 * Fetch the PRI03 CSV error report from Mirakl and parse it into structured results.
 *
 * MCP-verified endpoint (2026-05-08): GET /api/offers/pricing/imports/{import_id}/error_report
 * Path-parameterised. Returns CSV: col 1 = line number (1-based, matching PRI01 body rows),
 * col 2 = error reason code.
 *
 * Lines present in error report = failed. Lines absent = successfully imported.
 * The lineMap (from buildPri01Csv) maps 1-based body row index → shop_sku.
 *
 * @param {string} baseUrl - Marketplace base URL (e.g. 'https://worten.mirakl.net')
 * @param {string} apiKey - Decrypted shop_api_key (NEVER logged, NEVER in errors)
 * @param {string} importId - The PRI01 import UUID (path parameter)
 * @param {{ [lineNumber: number]: string }} lineMap - Line number → shop_sku from buildPri01Csv
 * @returns {Promise<{
 *   failedSkus: Array<{shopSku: string, errorCode: string, errorMessage: string}>,
 *   successfulSkus: Array<{shopSku: string}>
 * }>}
 * @throws {Error} on non-2xx HTTP response
 */
export async function fetchAndParseErrorReport (baseUrl, apiKey, importId, lineMap) {
  const url = `${baseUrl}/api/offers/pricing/imports/${importId}/error_report`;

  // Raw fetch (NOT mirAklGet) — mirAklGet calls res.json() on success and would
  // throw on the CSV body returned here. Raw fetch is allowed inside
  // shared/mirakl/ per the no-direct-fetch ESLint allowlist.
  // Retry pattern mirrors api-client.js / pri01-writer.js: 5 retries on
  // 429/5xx/transport errors, exponential backoff [1s, 2s, 4s, 8s, 16s].
  let lastStatus = 0;
  let res;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: apiKey, // NO Bearer prefix — empirically verified on all Mirakl endpoints
        },
      });
    } catch {
      // Transport-level failure (DNS, ECONNRESET, socket hang-up). Retry.
      lastStatus = 0;
      if (attempt < MAX_RETRIES) {
        await backoffDelay(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      // apiKey MUST NEVER appear in error messages
      throw new Error(`PRI03 error report fetch failed after ${MAX_RETRIES} retries: transport error for import ${importId}`);
    }

    if (res.ok) break;

    lastStatus = res.status;

    if (!isRetryable(res.status)) {
      // Non-retryable 4xx — throw immediately. apiKey NEVER in message.
      throw new Error(`PRI03 error report fetch failed: HTTP ${res.status} for import ${importId}`);
    }

    if (attempt < MAX_RETRIES) {
      await backoffDelay(RETRY_DELAYS_MS[attempt]);
    }
  }

  if (!res || !res.ok) {
    throw new Error(`PRI03 error report fetch failed after ${MAX_RETRIES} retries: HTTP ${lastStatus} for import ${importId}`);
  }

  const csvText = await res.text();

  // Parse CSV: each non-empty line is "lineNumber,errorCode" (comma or semicolon sep from Mirakl)
  // The MCP confirms: col 1 = line number, col 2 = error reason.
  // Lines are those of the original PRI01 body CSV (1-based, header excluded).
  const failedLineNumbers = new Set();
  const failedSkus = [];

  for (const rawLine of csvText.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // Split on first comma or semicolon — Mirakl error report uses comma separator
    const sepIdx = line.search(/[,;]/);
    if (sepIdx === -1) continue;

    const rawLineNum = line.slice(0, sepIdx).trim();
    const rawErrorCode = line.slice(sepIdx + 1).trim();

    const lineNumber = parseInt(rawLineNum, 10);
    if (Number.isNaN(lineNumber)) continue;

    const shopSku = lineMap[lineNumber];
    if (!shopSku) {
      // Line number in error report doesn't map to any SKU — defensive; log and skip
      logger.warn(
        { importId, lineNumber, rawErrorCode },
        'pri03-parser: error report line number has no matching shop_sku in lineMap — skipping'
      );
      continue;
    }

    failedLineNumbers.add(lineNumber);
    failedSkus.push({
      shopSku,
      errorCode: rawErrorCode,
      errorMessage: localizeErrorCode(rawErrorCode),
    });
  }

  // Successful SKUs = all SKUs in lineMap that did NOT appear in error report
  const failedShopSkus = new Set(failedSkus.map(f => f.shopSku));
  const allShopSkus = Object.values(lineMap);
  // Deduplicate (multi-channel SKUs appear multiple times in lineMap — same shopSku multiple lines)
  const uniqueAllSkus = [...new Set(allShopSkus)];
  const successfulSkus = uniqueAllSkus
    .filter(sku => !failedShopSkus.has(sku))
    .map(sku => ({ shopSku: sku }));

  logger.info(
    {
      importId,
      failedSkuCount: failedSkus.length,
      successfulSkuCount: successfulSkus.length,
    },
    'pri03-parser: error report parsed'
  );

  return { failedSkus, successfulSkus };
}

// ---------------------------------------------------------------------------
// scheduleRebuildForFailedSkus
// ---------------------------------------------------------------------------

/** Number of consecutive PRI01 failures that triggers 3-strike escalation */
const THREE_STRIKE_THRESHOLD = 3;

/**
 * For each failed SKU, inserts a fresh pri01_staging row for ALL channels of that SKU
 * (per-SKU rebuild — NOT just the failed line). Increments pri01_consecutive_failures.
 * At 3 consecutive failures: freezes the SKU (frozen_for_pri01_persistent = true),
 * emits a pri01-fail-persistent Atenção audit event, and sends a critical alert.
 *
 * Bundle C atomicity invariant: all DB writes use the injected `tx`.
 *
 * Design choice (AC#4 Option b):
 *   frozen_for_pri01_persistent boolean NOT NULL DEFAULT false
 *   Orthogonal to frozen_for_anomaly_review — no shared state.
 *
 * @param {object} params
 * @param {{ query: Function }} params.tx - Active transaction client (owned by caller)
 * @param {string} params.customerMarketplaceId - UUID of the customer_marketplace row
 * @param {Array<{shopSku: string, errorCode: string, errorMessage: string}>} params.failedSkus
 *   Failed SKUs from fetchAndParseErrorReport
 * @param {string} params.cycleId - UUID for the new staging row (rebuild cycle ID)
 * @returns {Promise<void>}
 */
export async function scheduleRebuildForFailedSkus ({
  tx,
  customerMarketplaceId,
  failedSkus,
  cycleId,
}) {
  if (!failedSkus || failedSkus.length === 0) {
    return;
  }

  for (const { shopSku, errorCode, errorMessage } of failedSkus) {
    // Step 1: Fetch ALL sku_channel rows for this shopSku + customer (per-SKU, not per-line)
    // This ensures the rebuild CSV includes ALL channels (delete-and-replace invariant).
    const { rows: channelRows } = await tx.query(
      `SELECT sc.id, sc.sku_id, sc.channel_code,
              sc.list_price_cents, sc.last_set_price_cents,
              sc.pri01_consecutive_failures
         FROM sku_channels sc
         JOIN skus s ON s.id = sc.sku_id
        WHERE sc.customer_marketplace_id = $1
          AND s.shop_sku = $2`,
      [customerMarketplaceId, shopSku]
    );

    if (channelRows.length === 0) {
      logger.warn(
        { customerMarketplaceId, shopSku },
        'pri03-parser: no sku_channel rows found for failed shopSku — skipping rebuild'
      );
      continue;
    }

    // The failure counter is per-SKU (not per-channel) — use the first row's value.
    // All channels of the same SKU share the same failure count semantically.
    const currentFailures = channelRows[0].pri01_consecutive_failures ?? 0;
    const newFailureCount = currentFailures + 1;

    // Step 2: Insert fresh pri01_staging rows for ALL channels of this SKU
    // Per-SKU rebuild: include EVERY channel so delete-and-replace is safe on retry.
    // Uses last_set_price_cents (not pending_set_price_cents — the failed import never applied).
    for (const ch of channelRows) {
      const priceCents = ch.last_set_price_cents ?? ch.list_price_cents;
      await tx.query(
        `INSERT INTO pri01_staging
           (customer_marketplace_id, sku_id, channel_code, new_price_cents, cycle_id, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [customerMarketplaceId, ch.sku_id, ch.channel_code, priceCents, cycleId]
      );
    }

    // Step 3: Increment pri01_consecutive_failures for all channels of this SKU
    // Target by sku_id + customer_marketplace_id (all channels of the SKU).
    await tx.query(
      `UPDATE sku_channels
          SET pri01_consecutive_failures = pri01_consecutive_failures + 1,
              updated_at = NOW()
        WHERE customer_marketplace_id = $1
          AND sku_id = $2`,
      [customerMarketplaceId, channelRows[0].sku_id]
    );

    logger.info(
      {
        customerMarketplaceId,
        shopSku,
        errorCode,
        newFailureCount,
        channelCount: channelRows.length,
      },
      'pri03-parser: rebuild staging rows inserted, failure counter incremented'
    );

    // Step 4: 3-strike escalation
    if (newFailureCount >= THREE_STRIKE_THRESHOLD) {
      // Freeze the SKU: set frozen_for_pri01_persistent = true for ALL channels
      // (Option b: parallel boolean, orthogonal to frozen_for_anomaly_review — AD24 / AC#4)
      await tx.query(
        `UPDATE sku_channels
            SET frozen_for_pri01_persistent = true,
                updated_at = NOW()
          WHERE customer_marketplace_id = $1
            AND sku_id = $2`,
        [customerMarketplaceId, channelRows[0].sku_id]
      );

      // Emit pri01-fail-persistent Atenção audit event (per-channel, same as pri02-poller pattern)
      for (const ch of channelRows) {
        try {
          await writeAuditEvent({
            tx,
            customerMarketplaceId,
            eventType: EVENT_TYPES.PRI01_FAIL_PERSISTENT,
            skuChannelId: ch.id,
            payload: {
              importId: cycleId,
              failureCount: newFailureCount,
              lastErrorMessage: errorMessage ?? DEFAULT_PT_ERROR,
            },
          });
        } catch (auditErr) {
          // Best-effort: audit INSERT may fail before Story 9.1 ships audit_log.
          // The freeze UPDATE already happened in the same tx — that's the safety net.
          logger.warn(
            { customerMarketplaceId, shopSku, err_name: auditErr?.name },
            'pri03-parser: pri01-fail-persistent audit event INSERT failed (expected pre-Story 9.1)'
          );
        }
      }

      logger.warn(
        {
          customerMarketplaceId,
          shopSku,
          failureCount: newFailureCount,
        },
        'pri03-parser: 3-strike escalation — SKU frozen (frozen_for_pri01_persistent = true), Atenção event emitted'
      );

      // Send Resend critical alert — best-effort, outside the tx boundary
      // (Resend is a side-effect; never let a send failure abort the DB transaction).
      try {
        const sendCriticalAlert = await getSendCriticalAlert();
        await sendCriticalAlert({
          to: process.env.MARKETPILOT_ALERT_EMAIL ?? process.env.RESEND_FROM_ADDRESS ?? 'noreply@marketpilot.pt',
          subject: `[MarketPilot] PRI01 persistent failure — ${shopSku} congelado`,
          html: `<p>O artigo <code>${shopSku}</code> falhou ${newFailureCount} importações PRI01 consecutivas.</p>
<p>Código de erro: <code>${errorCode}</code></p>
<p>O artigo foi <strong>congelado</strong> (<code>frozen_for_pri01_persistent = true</code>) e não será incluído em novos ciclos até resolução manual.</p>
<p>Customer marketplace: ${customerMarketplaceId}</p>`,
        });
      } catch (alertErr) {
        // Best-effort: critical alert failure must not abort repricing
        logger.warn(
          { customerMarketplaceId, shopSku, err_name: alertErr?.name },
          'pri03-parser: sendCriticalAlert failed (best-effort — repricing continues)'
        );
      }
    }
  }
}
