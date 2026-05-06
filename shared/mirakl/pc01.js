// shared/mirakl/pc01.js — AD16 SSoT: PC01 platform configuration wrapper (Story 3.2)
//
// Single source of truth for the Mirakl PC01 endpoint (GET /api/configuration).
// Normalizes the nested features.* live-API response to a flat shape; the mock
// server already returns the flat shape so the normalization path is a no-op there.
// All calls go through mirAklGet — no direct fetch() allowed.
import { mirAklGet } from './api-client.js';

/**
 * @typedef {Object} PlatformConfiguration
 * @property {string} channel_pricing - 'SINGLE' | 'MULTI' | 'DISABLED'
 * @property {string} operator_csv_delimiter - 'COMMA' | 'SEMICOLON'
 * @property {number} offer_prices_decimals
 * @property {boolean} discount_period_required
 * @property {boolean} scheduled_pricing
 * @property {boolean} volume_pricing
 * @property {boolean} competitive_pricing_tool
 * @property {boolean} multi_currency
 * @property {string} order_tax_mode
 * @property {object} _raw - Full API response for customer_marketplaces.platform_features_snapshot JSONB
 */

/**
 * PC01 — List platform configurations.
 * Normalizes the nested features.* live-API response to a flat shape.
 * When the response is already flat (mock server / future API change), it is
 * passed through as-is with _raw attached.
 *
 * @param {string} baseUrl - Marketplace base URL, e.g. 'https://worten.mirakl.net'
 * @param {string} apiKey - Decrypted Mirakl shop API key
 * @returns {Promise<PlatformConfiguration>}
 * @throws {import('./api-client.js').MiraklApiError}
 */
export async function getPlatformConfiguration (baseUrl, apiKey) {
  const raw = await mirAklGet(baseUrl, '/api/configuration', null, apiKey);

  // Live Mirakl response nests all settings under features.*.
  // Mock server returns flat shape directly — handle both paths.
  const f = raw.features;
  if (!f) {
    // Already flat (mock server or future API simplification) — pass through with _raw.
    return { ...raw, _raw: raw };
  }

  // Normalize nested live response to flat shape.
  return {
    channel_pricing:          f.pricing.channel_pricing,
    operator_csv_delimiter:   f.operator_csv_delimiter,
    offer_prices_decimals:    Number(f.offer_prices_decimals),  // MCP returns string
    discount_period_required: f.pricing.discount_period_required,
    scheduled_pricing:        f.pricing.scheduled_pricing,
    volume_pricing:           f.pricing.volume_pricing,
    competitive_pricing_tool: f.competitive_pricing_tool,
    order_tax_mode:           f.order_tax_mode,
    multi_currency:           f.multi_currency,
    _raw: raw,
  };
}
