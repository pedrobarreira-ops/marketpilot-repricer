// shared/mirakl/api-client.js — AD5 SSoT (Story 3.1)
//
// Central Mirakl HTTP client. ALL Mirakl GET calls go through mirAklGet().
// apiKey is ALWAYS a function parameter — never stored at module level.
//
// Auth header: `Authorization: <key>` (raw key, no Bearer prefix).
// Empirically confirmed on Worten (Gabriel's Easy-Store account, 2026-04-30).
// ⚠ Do NOT add 'Bearer ' prefix — it causes 401.
//
// Retry schedule: 5 retries, exponential backoff [1s, 2s, 4s, 8s, 16s].
// Retryable: 429 + 5xx + transport errors (status 0).
// Non-retryable: 4xx except 429 (fail immediately after 1 attempt).
import { getSafeErrorMessage } from './safe-error.js';

// ── Internal helpers ──────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const MAX_RETRIES = 5;

/**
 * @param {number} status - HTTP status code; 0 for transport errors
 * @returns {boolean} true if the status warrants a retry
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

/**
 * Derive a program-readable error code from an HTTP status.
 *
 * @param {number} status - HTTP status code; 0 for transport errors
 * @returns {string} code identifier
 */
function _codeFromStatus (status) {
  if (status === 401) return 'WORTEN_API_KEY_INVALID';
  if (status === 429) return 'WORTEN_RATE_LIMITED';
  if (status >= 500) return 'WORTEN_SERVER_ERROR';
  if (status === 0)  return 'WORTEN_TRANSPORT_ERROR';
  // Generic 4xx (403, 422, etc.)
  return 'WORTEN_REQUEST_REFUSED';
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Represents a non-2xx or transport-level error from the Mirakl API.
 * Carries a PT-localized customer-facing message via .safeMessagePt.
 * The raw upstream error text or apiKey MUST NEVER appear in any field.
 */
export class MiraklApiError extends Error {
  /**
   * @param {string} message - internal message (must not contain apiKey or raw upstream body)
   * @param {number} status - HTTP status code; 0 for transport errors
   * @param {string} [code] - program-readable identifier; derived from status if omitted
   */
  constructor (message, status, code) {
    super(message);
    this.name = 'MiraklApiError';
    this.status = status;
    this.code = code ?? _codeFromStatus(status);
    this.safeMessagePt = getSafeErrorMessage(this);
  }
}

/**
 * Single source of truth for all Mirakl HTTP GET calls.
 * apiKey is ALWAYS a parameter — never stored at module level (NFR-S1).
 *
 * @param {string} baseUrl - Marketplace base URL, e.g. 'https://worten.mirakl.net'
 * @param {string} path - API path, e.g. '/api/account/shop'
 * @param {Record<string, string | number | boolean>} params - query parameters
 * @param {string} apiKey - decrypted Mirakl shop API key for this customer
 * @returns {Promise<unknown>} parsed JSON response body on success
 * @throws {MiraklApiError} on non-2xx responses or transport errors after retries
 */
export async function mirAklGet (baseUrl, path, params, apiKey) {
  const url = new URL(baseUrl + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    url.searchParams.set(k, String(v));
  }

  // Raw key — no 'Bearer' prefix (empirically verified on Worten, 2026-04-30)
  const headers = { Authorization: apiKey };

  let lastStatus = 0;  // 0 = transport-level failure (no HTTP status received)
  let lastMessage = 'unknown';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(url.toString(), { headers });
    } catch {
      // Transport-level failure (DNS, ECONNRESET, socket hang-up, etc.)
      // — treated as retryable on the same schedule as 5xx / 429.
      lastStatus = 0;
      lastMessage = 'network error';
      if (attempt < MAX_RETRIES) {
        await backoffDelay(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      break;
    }

    if (res.ok) {
      return res.json();
    }

    lastStatus = res.status;
    lastMessage = `HTTP ${res.status}`;

    if (!isRetryable(res.status)) {
      // Non-retryable 4xx — throw immediately (1 attempt total)
      throw new MiraklApiError(`Mirakl API error: HTTP ${res.status}`, res.status);
    }

    if (attempt < MAX_RETRIES) {
      await backoffDelay(RETRY_DELAYS_MS[attempt]);
    }
  }

  throw new MiraklApiError(
    `Mirakl API error after ${MAX_RETRIES} retries: ${lastMessage}`,
    lastStatus,
  );
}

// Re-export getSafeErrorMessage so callers can import from a single entry-point
// and test files can import it from api-client.js (the canonical shared module).
export { getSafeErrorMessage } from './safe-error.js';
