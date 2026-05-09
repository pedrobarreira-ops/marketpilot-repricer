// shared/mirakl/pri01-writer.js — AD7 SSoT (Story 6.1)
//
// PRI01 CSV writer: aggregates per-SKU decisions from pri01_staging, builds
// the correct multipart CSV, submits it to Mirakl, and atomically marks all
// participating sku_channel rows with pending_import_id.
//
// Three exports:
//   buildPri01Csv       — pure function; builds header+body CSV string + lineMap
//   submitPriceImport   — multipart POST to PRI01 endpoint with retry/backoff
//   markStagingPending  — atomically updates sku_channels + pri01_staging in tx
//
// Auth header: `Authorization: <key>` (raw key, NO Bearer prefix).
// Empirically confirmed on Worten (all 6 calls, 2026-04-30).
//
// Retry schedule: 5 retries, exponential backoff [1s, 2s, 4s, 8s, 16s], cap 30s.
// Retryable: 429 + 5xx + transport errors (status 0).
// Non-retryable: 4xx except 429.
//
// ESLint: no-raw-CSV-building fires outside this file (allowlisted here).
// ESLint: fetch() is allowed here — this file IS in shared/mirakl/ (no-direct-fetch allowlist).

import { MiraklApiError } from './api-client.js';
import { createWorkerLogger } from '../logger.js';

const logger = createWorkerLogger();

// ── Internal retry helpers (duplicated from api-client.js — NOT imported to
//    avoid circular module dependency risk at MVP scale; refactor to
//    shared/mirakl/retry.js if a third module needs this) ────────────────────

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

// ── Delimiter resolution ──────────────────────────────────────────────────────

/**
 * Resolve the string delimiter character from the operator_csv_delimiter enum.
 *
 * @param {string|null|undefined} operatorCsvDelimiter
 * @param {string} customerMarketplaceId - UUID included in error messages
 * @returns {string} the resolved delimiter character
 * @throws {Error} when operatorCsvDelimiter is null/undefined
 */
function resolveDelimiter (operatorCsvDelimiter, customerMarketplaceId) {
  if (operatorCsvDelimiter === null || operatorCsvDelimiter === undefined) {
    throw new Error(
      `PC01 capture incomplete for customer_marketplace ${customerMarketplaceId}: ` +
      `operator_csv_delimiter or offer_prices_decimals is NULL. ` +
      `Re-run onboarding scan or PC01 monthly re-pull (Story 12.4) to populate.`,
    );
  }
  if (operatorCsvDelimiter === 'SEMICOLON') return ';';
  if (operatorCsvDelimiter === 'COMMA') return ',';
  // Unrecognised enum value — treat same as missing (safe default refused per AC#3)
  throw new Error(
    `PC01 capture incomplete for customer_marketplace ${customerMarketplaceId}: ` +
    `operator_csv_delimiter value '${operatorCsvDelimiter}' is unrecognised. ` +
    `Expected SEMICOLON or COMMA.`,
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Build a PRI01 CSV body from an array of sku_channel-like objects.
 *
 * PRI01 uses delete-and-replace semantics PER (offer-sku, channel) pair:
 * for any SKU represented in the CSV, any channel of that SKU NOT in the
 * submitted CSV gets its price deleted by Mirakl. Passthrough lines
 * (channels with no new staging decision) MUST therefore be included using
 * lastSetPriceCents — for every channel of every participating SKU.
 *
 * Multi-SKU usage is supported: rows for multiple shopSku values may be
 * concatenated in one call, and the cycle path normally builds one CSV per
 * cycle covering every staged SKU and its passthrough channels in a single
 * submission (see markStagingPending which marks per-cycle, not per-SKU).
 *
 * @param {object} opts
 * @param {Array<{shopSku: string, channelCode: string, newPriceCents: number|null|undefined, lastSetPriceCents: number}>} opts.skuChannels
 *   Every channel row to emit. For each participating SKU, ALL of its channels
 *   must be present (passthrough or staged) — see delete-and-replace note above.
 *   newPriceCents present = staged decision; absent/null = passthrough.
 * @param {string|null|undefined} opts.operatorCsvDelimiter - 'SEMICOLON' | 'COMMA' (from customer_marketplaces)
 * @param {number|null|undefined} opts.offerPricesDecimals - integer decimal places (from customer_marketplaces)
 * @param {string} opts.customerMarketplaceId - UUID included in error messages
 * @returns {{ csvBody: string, lineMap: { [lineNumber: number]: string } }}
 *   csvBody: full CSV string including header, LF line endings, trailing LF.
 *   lineMap: 1-based body-row index → shopSku (used by PRI03 parser, Story 6.3).
 * @throws {Error} when operatorCsvDelimiter or offerPricesDecimals is null/undefined
 */
export function buildPri01Csv ({ skuChannels, operatorCsvDelimiter, offerPricesDecimals, customerMarketplaceId }) {
  // Guard: offerPricesDecimals first so the error message is accurate
  if (offerPricesDecimals === null || offerPricesDecimals === undefined) {
    throw new Error(
      `PC01 capture incomplete for customer_marketplace ${customerMarketplaceId}: ` +
      `operator_csv_delimiter or offer_prices_decimals is NULL. ` +
      `Re-run onboarding scan or PC01 monthly re-pull (Story 12.4) to populate.`,
    );
  }

  const delim = resolveDelimiter(operatorCsvDelimiter, customerMarketplaceId);

  const header = `offer-sku${delim}price${delim}channels`;
  const bodyLines = [];
  /** @type {{ [lineNumber: number]: string }} */
  const lineMap = {};

  for (const ch of skuChannels) {
    // Use staged new price if present; fall back to lastSetPriceCents (passthrough)
    const priceCents = (ch.newPriceCents !== null && ch.newPriceCents !== undefined)
      ? ch.newPriceCents
      : ch.lastSetPriceCents;

    // Format to offerPricesDecimals decimal places; toFixed() always uses ASCII period
    const priceStr = (priceCents / 100).toFixed(offerPricesDecimals);

    const lineIndex = bodyLines.length + 1;  // 1-based
    bodyLines.push(`${ch.shopSku}${delim}${priceStr}${delim}${ch.channelCode}`);
    lineMap[lineIndex] = ch.shopSku;
  }

  // csvBody: header + body lines, LF line endings, trailing LF, no BOM
  const csvBody = [header, ...bodyLines].join('\n') + '\n';

  return { csvBody, lineMap };
}

/**
 * Submit a PRI01 price import to Mirakl via multipart POST.
 *
 * Endpoint: POST <baseUrl>/api/offers/pricing/imports
 * Auth: raw `Authorization: <apiKey>` header — NO Bearer prefix.
 * Body: multipart/form-data with the CSV as a 'file' part (prices.csv).
 *
 * @param {string} baseUrl - Marketplace base URL, e.g. 'https://worten.mirakl.net'
 * @param {string} apiKey - decrypted Mirakl shop API key (NEVER logged or exposed in errors)
 * @param {string} csvBody - CSV string from buildPri01Csv
 * @returns {Promise<{ importId: string }>} the Mirakl import_id mapped to camelCase
 * @throws {MiraklApiError} on non-2xx responses or transport errors after retries
 */
export async function submitPriceImport (baseUrl, apiKey, csvBody) {
  const endpoint = `${baseUrl}/api/offers/pricing/imports`;

  let lastStatus = 0;
  let lastMessage = 'unknown';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      const form = new FormData();
      form.append('file', new Blob([csvBody], { type: 'text/csv' }), 'prices.csv');
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: apiKey },  // NO Bearer prefix — empirically verified
        body: form,
      });
    } catch {
      // Transport-level failure (DNS, ECONNRESET, socket hang-up, etc.)
      lastStatus = 0;
      lastMessage = 'network error';
      if (attempt < MAX_RETRIES) {
        await backoffDelay(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      break;
    }

    if (res.ok) {
      const body = await res.json();
      // Map Mirakl snake_case import_id → camelCase importId
      return { importId: body.import_id };
    }

    lastStatus = res.status;
    lastMessage = `HTTP ${res.status}`;

    // apiKey must NEVER appear in error messages — log only status/code
    logger.warn({ status: res.status, attempt }, 'PRI01 submit attempt failed');

    if (!isRetryable(res.status)) {
      // Non-retryable 4xx — throw immediately (1 attempt total)
      throw new MiraklApiError(`PRI01 API error: HTTP ${res.status}`, res.status);
    }

    if (attempt < MAX_RETRIES) {
      await backoffDelay(RETRY_DELAYS_MS[attempt]);
    }
  }

  throw new MiraklApiError(
    `PRI01 API error after ${MAX_RETRIES} retries: ${lastMessage}`,
    lastStatus,
  );
}

/**
 * Atomically mark all participating sku_channel rows with pending_import_id.
 *
 * Called inside a transaction after submitPriceImport returns the importId.
 * Ensures Bundle C atomicity invariant: zero rows in the cycle batch have
 * pending_import_id IS NULL after this function returns.
 *
 * AC#6 (course correction 2026-05-09): When `lineMap` is provided (as returned by
 * buildPri01Csv), this function also persists csv_line_number in each pri01_staging
 * row inside the same transaction. This allows pri02-poller.js to reconstruct the
 * lineMap at PRI02 poll time without the transient in-memory CSV data.
 *
 * @param {object} opts
 * @param {{ query: Function }} opts.tx - active transaction client (service-role)
 * @param {string} opts.cycleId - UUID of the current pricing cycle
 * @param {string} opts.importId - UUID returned by submitPriceImport
 * @param {string} opts.customerMarketplaceId - UUID (required; satisfies worker-must-filter-by-customer)
 * @param {{ [lineNumber: number]: string } | null} [opts.lineMap] - Optional line-number → shopSku map
 *   from buildPri01Csv. When provided, csv_line_number is persisted per pri01_staging row.
 * @returns {Promise<void>}
 */
export async function markStagingPending ({ tx, cycleId, importId, customerMarketplaceId, lineMap = null }) {
  // Step 1: Fetch all staging rows for this cycle + customer.
  // Also fetch id and join skus for shop_sku (needed for csv_line_number persistence via lineMap).
  const stagingResult = await tx.query(
    `SELECT s.id, s.sku_id, s.channel_code, s.new_price_cents, sk.shop_sku
       FROM pri01_staging s
       JOIN skus sk ON sk.id = s.sku_id
      WHERE s.cycle_id = $1
        AND s.customer_marketplace_id = $2`,
    [cycleId, customerMarketplaceId],
  );

  const stagedRows = stagingResult.rows;
  if (stagedRows.length === 0) {
    return;  // Nothing to mark — cycle was empty
  }

  // Build lookup: `${sku_id}:${channel_code}` → new_price_cents (per-channel key)
  // Also collect unique sku_ids for the sku_channels query
  /** @type {Map<string, number>} */
  const stagedBySkuChannel = new Map();
  /** @type {Set<string>} */
  const allSkuIds = new Set();
  // Build `shop_sku:channel_code` → staging.id for csv_line_number persistence
  /** @type {Map<string, string>} */
  const stagingIdByShopSkuChannel = new Map();

  for (const row of stagedRows) {
    stagedBySkuChannel.set(`${row.sku_id}:${row.channel_code}`, row.new_price_cents);
    allSkuIds.add(row.sku_id);
    if (row.shop_sku) {
      stagingIdByShopSkuChannel.set(`${row.shop_sku}:${row.channel_code}`, row.id);
    }
  }

  // Step 2: Load ALL sku_channel rows for every SKU in the batch
  // (includes passthrough channels that didn't have a staging decision)
  const channelResult = await tx.query(
    `SELECT sc.id, sc.sku_id, sc.channel_code, sc.last_set_price_cents
       FROM sku_channels sc
      WHERE sc.customer_marketplace_id = $1
        AND sc.sku_id = ANY($2)`,
    [customerMarketplaceId, Array.from(allSkuIds)],
  );

  const channelRows = channelResult.rows;

  // Step 3: Update each sku_channel row — staged channels use new_price_cents,
  // passthrough channels (no staging row for their specific sku+channel) use last_set_price_cents
  for (const ch of channelRows) {
    const channelKey = `${ch.sku_id}:${ch.channel_code}`;
    const stagedPrice = stagedBySkuChannel.get(channelKey);
    const pendingSetPriceCents = (stagedPrice !== undefined)
      ? stagedPrice
      : ch.last_set_price_cents;  // passthrough: channel not in staging for this cycle

    await tx.query(
      `UPDATE sku_channels
          SET pending_import_id = $1,
              pending_set_price_cents = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [importId, pendingSetPriceCents, ch.id],
    );
  }

  // Step 4: Mark all staging rows as flushed (bulk update for the cycle)
  await tx.query(
    `UPDATE pri01_staging
        SET flushed_at = NOW(),
            import_id = $1
      WHERE cycle_id = $2
        AND customer_marketplace_id = $3`,
    [importId, cycleId, customerMarketplaceId],
  );

  // Step 5: Persist csv_line_number per staging row (AC#6 — course correction 2026-05-09).
  // lineMap is { [lineNumber]: shopSku } from buildPri01Csv (one entry per CSV body row).
  // Each lineNumber corresponds to one (shopSku, channelCode) pair in the staging rows.
  // Multiple line numbers can share the same shopSku (one per channel).
  // We need the (shopSku, channelCode) → staging.id mapping to target the correct row.
  // Since lineMap only has shopSku (not channelCode), we iterate stagedRows to match
  // line numbers by tracking which shopSku lines have been assigned (in CSV body row order).
  if (lineMap && Object.keys(lineMap).length > 0) {
    // Build shopSku → ordered list of staging IDs (preserving channel iteration order)
    // Note: stagedRows ordering reflects the order the writer built the CSV (same skuChannels order).
    // Map line number → staging.id by tracking which staging row each CSV line corresponds to.
    // Since lineMap is { lineNumber: shopSku } and multiple lines can share a shopSku (different channels),
    // we track per-shopSku how many lines have been assigned so far to advance through the channel list.
    /** @type {Map<string, string[]>} */
    const stagingIdsByShopSku = new Map();
    for (const row of stagedRows) {
      if (!row.shop_sku) continue;
      if (!stagingIdsByShopSku.has(row.shop_sku)) {
        stagingIdsByShopSku.set(row.shop_sku, []);
      }
      stagingIdsByShopSku.get(row.shop_sku).push(row.id);
    }

    /** @type {Map<string, number>} shopSku → index of next staging id to assign */
    const shopSkuAssignIdx = new Map();

    // Sort line numbers numerically so we assign staging IDs in CSV body order
    const sortedLineNumbers = Object.keys(lineMap)
      .map(n => parseInt(n, 10))
      .sort((a, b) => a - b);

    for (const lineNumber of sortedLineNumbers) {
      const shopSku = lineMap[lineNumber];
      const stagingIds = stagingIdsByShopSku.get(shopSku);
      if (!stagingIds || stagingIds.length === 0) {
        logger.warn(
          { cycleId, lineNumber, shopSku },
          'pri01-writer: no staging row found for shopSku in lineMap — csv_line_number not persisted for this line'
        );
        continue;
      }

      const idx = shopSkuAssignIdx.get(shopSku) ?? 0;
      const stagingId = stagingIds[idx];
      if (!stagingId) {
        logger.warn(
          { cycleId, lineNumber, shopSku, idx },
          'pri01-writer: staging ID index out of bounds for shopSku — csv_line_number not persisted for this line'
        );
        continue;
      }

      shopSkuAssignIdx.set(shopSku, idx + 1);

      await tx.query(
        'UPDATE pri01_staging SET csv_line_number = $1 WHERE id = $2',
        [lineNumber, stagingId]
      );
    }
  }
}
