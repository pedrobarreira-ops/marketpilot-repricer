// shared/mirakl/a01.js — AD16 SSoT: A01 account wrapper (Story 3.2)
//
// Single source of truth for the Mirakl A01 endpoint (GET /api/account).
// All calls go through mirAklGet — direct fetch is prohibited by ESLint no-direct-fetch rule.
import { mirAklGet } from './api-client.js';

/**
 * @typedef {Object} AccountInfo
 * @property {number} shop_id
 * @property {string} shop_name
 * @property {string} [shop_state] - Optional pass-through; present on Worten ('OPEN'), not in MCP spec
 * @property {string} currency_iso_code
 * @property {boolean} is_professional
 * @property {Array<{code: string, label: string}>} channels
 * @property {string[]} domains
 */

/**
 * A01 — Get shop information.
 * Returns the raw API response; no normalization required (A01 shape matches spec).
 *
 * @param {string} baseUrl - Marketplace base URL, e.g. 'https://worten.mirakl.net'
 * @param {string} apiKey - Decrypted Mirakl shop API key
 * @returns {Promise<AccountInfo>}
 * @throws {import('./api-client.js').MiraklApiError}
 */
export async function getAccount (baseUrl, apiKey) {
  return mirAklGet(baseUrl, '/api/account', null, apiKey);
}
