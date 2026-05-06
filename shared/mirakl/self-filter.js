// shared/mirakl/self-filter.js — AD13+AD14 SSoT: competitor-offer filter chain (Story 3.2)
//
// Single source of truth for the competitor-offer filter chain applied to P11 results.
// Filter order (AD14 then AD13): active → positive total_price → not-own → sort ascending.
// Collision detection (AD13 defensive) checks raw input BEFORE filtering.

/**
 * @typedef {Object} FilterResult
 * @property {object[]} filteredOffers - Sorted ascending by total_price; own-shop, inactive,
 *   and zero/non-finite-price offers removed
 * @property {boolean} collisionDetected - True if more than one raw offer matched ownShopName
 *   (AD13 defensive: signals a data anomaly for the caller to log/handle)
 */

/**
 * Apply the AD13 + AD14 competitor-offer filter chain to a raw P11 offer list.
 *
 * Filter order:
 *   1. active === true          (AD14: inactive offers excluded)
 *   2. total_price > 0 && isFinite(total_price)  (AD14: zero/non-finite price excluded)
 *   3. shop_name !== ownShopName                 (AD13: own-shop excluded)
 *   4. sort ascending by total_price             (cheapest competitor first)
 *
 * Collision check runs on the raw input (before any filtering) so that an inactive
 * own-shop offer still contributes to the collision signal.
 *
 * @param {object[]} rawOffers - Unfiltered P11 offer list from getProductOffersByEan
 * @param {string} ownShopName - customer_marketplace.shop_name from A01 (e.g. 'Easy - Store')
 * @returns {FilterResult}
 */
export function filterCompetitorOffers (rawOffers, ownShopName) {
  // Defensive: tolerate null/undefined input (caller bug surfaces later as
  // "no competitors" rather than an opaque TypeError mid-pipeline).
  const offers = rawOffers ?? [];

  // AD13 collision check on raw input (before any filtering)
  const collisionDetected = offers.filter(o => o.shop_name === ownShopName).length > 1;

  const filteredOffers = offers
    .filter(o => o.active === true)
    .filter(o => Number.isFinite(o.total_price) && o.total_price > 0)
    .filter(o => o.shop_name !== ownShopName)
    .sort((a, b) => a.total_price - b.total_price);

  return { filteredOffers, collisionDetected };
}
