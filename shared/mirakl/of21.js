// shared/mirakl/of21.js — AD16 SSoT: OF21 own-offers wrapper (Story 3.2)
//
// Single source of truth for the Mirakl OF21 endpoint (GET /api/offers).
// Pagination is offset-based (MCP-confirmed) — NOT cursor/token based.
// All calls go through mirAklGet — direct fetch is prohibited by ESLint no-direct-fetch rule.
import { mirAklGet } from './api-client.js';

/**
 * Get one page of own offers from OF21.
 * Returns a pageToken (the next offset as integer) for callers that want to
 * drive their own pagination loop, or null when there are no more pages.
 *
 * @param {string} baseUrl - Marketplace base URL, e.g. 'https://worten.mirakl.net'
 * @param {string} apiKey - Decrypted Mirakl shop API key
 * @param {{ offset?: number, pageSize?: number }} [opts]
 * @returns {Promise<{ offers: object[], pageToken: number|null }>}
 * @throws {import('./api-client.js').MiraklApiError}
 */
export async function getOffers (baseUrl, apiKey, { offset = 0, pageSize = 100 } = {}) {
  const params = { offset, max: pageSize };
  const res = await mirAklGet(baseUrl, '/api/offers', params, apiKey);
  const offers = res.offers ?? [];
  const total = res.total_count ?? 0;
  const nextOffset = offset + offers.length < total ? offset + offers.length : null;
  return { offers, pageToken: nextOffset };
}

/**
 * Iterate all pages of own offers until exhausted.
 * Drives the offset-pagination loop internally and returns a flat array of all
 * offers across all pages.
 *
 * @param {string} baseUrl - Marketplace base URL, e.g. 'https://worten.mirakl.net'
 * @param {string} apiKey - Decrypted Mirakl shop API key
 * @returns {Promise<object[]>}
 * @throws {import('./api-client.js').MiraklApiError}
 */
export async function getAllOffers (baseUrl, apiKey) {
  const all = [];
  let offset = 0;
  for (;;) {
    const { offers, pageToken } = await getOffers(baseUrl, apiKey, { offset });
    all.push(...offers);
    if (pageToken === null) break;
    offset = pageToken;
  }
  return all;
}
