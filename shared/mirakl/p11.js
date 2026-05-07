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
  if (typeof ean !== 'string' || ean.length === 0) {
    // Defensive guard: an empty/undefined EAN would interpolate as
    // "EAN|undefined" or "EAN|" and yield an opaque Mirakl 400 stripped
    // of useful diagnostics. Fail loud at the call site instead.
    throw new TypeError(`getProductOffersByEan: ean must be a non-empty string, got ${typeof ean === 'string' ? '""' : typeof ean}`);
  }
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
  if (!Array.isArray(eans)) {
    throw new TypeError(`getProductOffersByEanBatch: eans must be an array, got ${typeof eans}`);
  }
  if (eans.length === 0) {
    // Empty input is a no-op: avoid a wasted API call that would either return
    // every product or yield an opaque 400 from product_references="".
    return [];
  }
  if (eans.length > 100) {
    // Defensive guard: Mirakl P11 caps batch lookups at 100 EANs per call.
    // Caller must chunk; an over-large URL would otherwise yield an opaque
    // 414 URI Too Long instead of this explicit error.
    throw new RangeError(`getProductOffersByEanBatch: max 100 EANs per call, got ${eans.length}`);
  }
  // Note: pricing_channel_code reuses `channel` because batch callers (Story 4.4
  // catalog scan) always operate within a single pricing channel. The single-EAN
  // wrapper exposes pricingChannelCode separately for engine callers (Story 7.2)
  // that may need cross-channel ranking.
  const productRefs = eans.map(e => `EAN|${e}`).join(',');
  const params = {
    product_references: productRefs,
    channel_codes: channel,
    pricing_channel_code: channel,
  };
  const res = await mirAklGet(baseUrl, '/api/products/offers', params, apiKey);
  return (res.products ?? []).flatMap(p => p.offers ?? []);
}

/**
 * P11 — batch EAN lookup with per-EAN grouping (up to 100 EANs per call).
 *
 * Same wire call as `getProductOffersByEanBatch`, but preserves the
 * `products[].offers[]` grouping so callers can map offers back to the EAN
 * they were quoted for. Story 4.4's onboarding-scan needs per-EAN tier
 * classification — flattening into a single offer list (as the original
 * batch wrapper does) loses the EAN→offers association required for
 * correct per-EAN classification.
 *
 * EAN extraction precedence (per P11 schema): the `product_references` array
 * on each `products[]` entry. We pick the entry whose `reference_type === 'EAN'`
 * and use its `reference` value as the map key. Products without an EAN
 * `product_references` entry are skipped (defensive: shouldn't happen for an
 * EAN-keyed query, but the schema permits the field).
 *
 * @param {string} baseUrl - Marketplace base URL, e.g. 'https://worten.mirakl.net'
 * @param {string} apiKey - Decrypted Mirakl shop API key
 * @param {{ eans: string[], channel: string }} opts
 * @returns {Promise<Map<string, object[]>>} Map: ean → raw offers array (filter via self-filter.js)
 * @throws {RangeError} when more than 100 EANs are passed (Mirakl P11 limit)
 * @throws {import('./api-client.js').MiraklApiError}
 */
export async function getProductOffersByEanBatchGrouped (baseUrl, apiKey, { eans, channel }) {
  if (!Array.isArray(eans)) {
    throw new TypeError(`getProductOffersByEanBatchGrouped: eans must be an array, got ${typeof eans}`);
  }
  if (eans.length === 0) {
    return new Map();
  }
  if (eans.length > 100) {
    throw new RangeError(`getProductOffersByEanBatchGrouped: max 100 EANs per call, got ${eans.length}`);
  }

  const productRefs = eans.map(e => `EAN|${e}`).join(',');
  const params = {
    product_references: productRefs,
    channel_codes: channel,
    pricing_channel_code: channel,
  };
  const res = await mirAklGet(baseUrl, '/api/products/offers', params, apiKey);

  const grouped = new Map();
  // Pre-seed with empty offer arrays for every requested EAN so callers can
  // distinguish "no competitors" from "EAN absent in response" via Map.has().
  for (const ean of eans) {
    grouped.set(ean, []);
  }

  for (const product of (res.products ?? [])) {
    const eanRef = product.product_references?.find(r => r.reference_type === 'EAN');
    const ean = eanRef?.reference;
    if (typeof ean !== 'string' || ean.length === 0) continue;
    grouped.set(ean, product.offers ?? []);
  }

  return grouped;
}
