// worker/src/lib/tier-classify.js
//
// Story 4.4 — Initial tier classification at scan time ONLY.
//
// SSoT for initial tier assignment during the onboarding catalog scan.
// These rules apply ONCE at scan time: classify each sku_channel into its
// starting tier based on whether we have competitors and whether we're winning.
//
// IMPORTANT: This file is NOT the same as worker/src/engine/tier-classify.js (Story 7.5).
//   - This file: initial scan-time classification (PROVISIONING → DRY_RUN path)
//   - Story 7.5 file: engine tier transitions during repricer cycles (T2a→T2b timing, etc.)
//
// Architecture constraints satisfied (Story 4.4):
//   - Named exports only (no default export)
//   - No .then() chains (async/await only)
//   - No console.log (pino logger rule — no logger needed, pure function)
//   - Tier 2b NOT assigned here (requires 4h elapsed since last_won_at — impossible at scan time)

/**
 * Classify the initial tier for a sku_channel at scan time.
 *
 * Classification rules (AD10):
 *   - No competitors after filter chain → Tier 3, cadence 1440 min
 *   - Competitors exist, we're losing (our price > lowest competitor price) → Tier 1, cadence 15 min
 *   - Competitors exist, we're winning or tied (our price <= lowest competitor price)
 *     → Tier 2a, cadence 15 min, lastWonAt = new Date()
 *
 * Tier 2b is NOT assigned at initial classification (requires 4h elapsed since
 * last_won_at — impossible at scan time; Story 7.5 handles T2a→T2b transitions).
 *
 * @param {number} ownCurrentPriceCents - Our current total price in integer cents (from OF21 total_price * 100)
 * @param {Array<{total_price: number}>} competitorOffers - Already filtered + sorted ascending by total_price (from self-filter.js filterCompetitorOffers)
 * @returns {{ tier: '1'|'2a'|'3', tierCadenceMinutes: number, lastWonAt: Date|null }}
 */
export function classifyInitialTier (ownCurrentPriceCents, competitorOffers) {
  // No competitors after self-filter chain → Tier 3 (daily check)
  if (!competitorOffers || competitorOffers.length === 0) {
    return { tier: '3', tierCadenceMinutes: 1440, lastWonAt: null };
  }

  // competitorOffers is sorted ascending by total_price (self-filter.js guarantees this)
  // Cheapest competitor is first
  const lowestCompetitorCents = Math.round(competitorOffers[0].total_price * 100); // eslint-disable-line local-money/no-float-price -- TODO Story 7.2+: migrate to toCents()

  if (ownCurrentPriceCents <= lowestCompetitorCents) {
    // We're winning or tied at 1st — Tier 2a
    // All initial wins recorded as NOW() (no prior win history at scan time)
    return { tier: '2a', tierCadenceMinutes: 15, lastWonAt: new Date() };
  }

  // We're losing — Tier 1 (needs repricing, check every 15 min)
  return { tier: '1', tierCadenceMinutes: 15, lastWonAt: null };
}
