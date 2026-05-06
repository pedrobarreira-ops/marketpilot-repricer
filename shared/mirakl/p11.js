// shared/mirakl/p11.js — AD16 SSoT: P11 product-offers wrapper (Story 3.2)
//
// Single source of truth for the Mirakl P11 endpoint (GET /api/products/offers).
// Returns raw offer arrays — filtering is delegated to self-filter.js (AD13+AD14).
// Uses product_references=EAN|<ean> format (MCP-confirmed, not product_ids).
// All calls go through mirAklGet — direct fetch is prohibited by ESLint no-direct-fetch rule.
import { mirAklGet } from './api-client.js';

/**
 * P11 — single EAN + channel lookup.
 * Returns the raw offer array for the matched product.
 * Filtering (own-shop exclusion, active/price guards) is done by self-filter.js.
 *
 * @param {string} baseUrl - Marketplace base URL, e.g. 'https://worten.mirakl.net'
 * @param {string} apiKey - Decrypted Mirakl shop API key
 * @param {{ ean: string, channel: string, pricingChannelCode: string }} opts
 * @returns {Promise<object[]>} Raw offers array from products[0].offers
 * @throws {import('./api-client.js').MiraklApiError}
 */
export async function getProductOffersByEan (baseUrl, apiKey, { ean, channel, pricingChannelCode }) {
  const params = {
    product_references: `EAN|${ean}`,
    channel_codes: channel,
    pricing_channel_code: pricingChannelCode,
  };
  const res = await mirAklGet(baseUrl, '/api/products/offers', params, apiKey);
  return res.products?.[0]?.offers ?? [];
}

/**
 * P11 — batch EAN lookup (up to 100 EANs per call).
 * Concatenates EANs as EAN|x,EAN|y,... in product_references (MCP-confirmed format).
 * Returns a flat array of all offers across all returned products.
 *
 * @param {string} baseUrl - Marketplace base URL, e.g. 'https://worten.mirakl.net'
 * @param {string} apiKey - Decrypted Mirakl shop API key
 * @param {{ eans: string[], channel: string }} opts
 * @returns {Promise<object[]>}
 * @throws {RangeError} when more than 100 EANs are passed (Mirakl P11 limit)
 * @throws {import('./api-client.js').MiraklApiError}
 */
export async function getProductOffersByEanBatch (baseUrl, apiKey, { eans, channel }) {
  if (eans.length > 100) {
    // Defensive guard: Mirakl P11 caps batch lookups at 100 EANs per call.
    // Caller must chunk; an over-large URL would otherwise yield an opaque
    // 414 URI Too Long instead of this explicit error.
    throw new RangeError(`getProductOffersByEanBatch: max 100 EANs per call, got ${eans.length}`);
  }
  const productRefs = eans.map(e => `EAN|${e}`).join(',');
  const params = {
    product_references: productRefs,
    channel_codes: channel,
    pricing_channel_code: channel,
  };
  const res = await mirAklGet(baseUrl, '/api/products/offers', params, apiKey);
  return (res.products ?? []).flatMap(p => p.offers ?? []);
}
