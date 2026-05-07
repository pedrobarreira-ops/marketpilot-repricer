// tests/worker/src/lib/tier-classify.test.js
//
// Story 4.4 / AC#5 unit tests for worker/src/lib/tier-classify.js
//
// Covers:
//   - No competitors → Tier 3, cadence 1440 min, lastWonAt null
//   - Competitors exist, we're losing → Tier 1, cadence 15 min, lastWonAt null
//   - Competitors exist, we're winning → Tier 2a, cadence 15 min, lastWonAt non-null
//   - Competitors exist, we're tied → Tier 2a (<=, not <)
//   - Tier 2b is never returned (only classifyInitialTier handles scan-time tiers)
//   - Empty competitors array → Tier 3
//   - Null competitors → Tier 3 (defensive null handling)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyInitialTier } from '../../../../worker/src/lib/tier-classify.js';

test('classifyInitialTier: no competitors → Tier 3', () => {
  const result = classifyInitialTier(2200, []);
  assert.equal(result.tier, '3');
  assert.equal(result.tierCadenceMinutes, 1440);
  assert.equal(result.lastWonAt, null);
});

test('classifyInitialTier: null competitors → Tier 3 (defensive)', () => {
  const result = classifyInitialTier(2200, null);
  assert.equal(result.tier, '3');
  assert.equal(result.tierCadenceMinutes, 1440);
  assert.equal(result.lastWonAt, null);
});

test('classifyInitialTier: undefined competitors → Tier 3 (defensive)', () => {
  const result = classifyInitialTier(2200, undefined);
  assert.equal(result.tier, '3');
  assert.equal(result.tierCadenceMinutes, 1440);
  assert.equal(result.lastWonAt, null);
});

test('classifyInitialTier: our price > competitor price → Tier 1 (losing)', () => {
  // Our price: €23.00 (2300 cents), competitor: €22.00 (2200 cents) — we're losing
  const competitors = [{ total_price: 22.00 }];
  const result = classifyInitialTier(2300, competitors);
  assert.equal(result.tier, '1');
  assert.equal(result.tierCadenceMinutes, 15);
  assert.equal(result.lastWonAt, null);
});

test('classifyInitialTier: our price < competitor price → Tier 2a (winning)', () => {
  // Our price: €21.00 (2100 cents), competitor: €22.00 (2200 cents) — we're winning
  const competitors = [{ total_price: 22.00 }];
  const result = classifyInitialTier(2100, competitors);
  assert.equal(result.tier, '2a');
  assert.equal(result.tierCadenceMinutes, 15);
  assert.ok(result.lastWonAt instanceof Date, 'lastWonAt must be a Date when winning');
});

test('classifyInitialTier: our price === competitor price → Tier 2a (tied = winning)', () => {
  // Our price: €22.00 (2200 cents), competitor: €22.00 (2200 cents) — tied at 1st → Tier 2a
  const competitors = [{ total_price: 22.00 }];
  const result = classifyInitialTier(2200, competitors);
  assert.equal(result.tier, '2a', 'Tied price must classify as Tier 2a (we are not losing)');
  assert.equal(result.tierCadenceMinutes, 15);
  assert.ok(result.lastWonAt instanceof Date, 'lastWonAt must be a Date when tied');
});

test('classifyInitialTier: uses only top competitor (sorted ascending)', () => {
  // Competitors: [€20.00, €21.00, €23.00] — sorted by self-filter.js before call
  // Our price: €21.50 — cheapest competitor is €20.00, we're losing
  const competitors = [
    { total_price: 20.00 },
    { total_price: 21.00 },
    { total_price: 23.00 },
  ];
  const result = classifyInitialTier(2150, competitors);
  assert.equal(result.tier, '1');
  assert.equal(result.tierCadenceMinutes, 15);
  assert.equal(result.lastWonAt, null);
});

test('classifyInitialTier: our price above top of multiple competitors → Tier 1', () => {
  // Our price: €25.00 (2500 cents), multiple cheap competitors
  const competitors = [
    { total_price: 19.99 },
    { total_price: 21.00 },
    { total_price: 24.00 },
  ];
  const result = classifyInitialTier(2500, competitors);
  assert.equal(result.tier, '1');
  assert.equal(result.tierCadenceMinutes, 15);
});

test('classifyInitialTier: lastWonAt is a recent Date (not a fixed date)', () => {
  const before = new Date();
  const competitors = [{ total_price: 25.00 }];
  const result = classifyInitialTier(2000, competitors);
  const after = new Date();

  assert.ok(result.lastWonAt >= before, 'lastWonAt must be >= test start');
  assert.ok(result.lastWonAt <= after, 'lastWonAt must be <= test end');
});

test('classifyInitialTier: Tier 2b is never returned (not applicable at scan time)', () => {
  const competitors = [{ total_price: 22.00 }];
  const winning = classifyInitialTier(2000, competitors);
  const losing = classifyInitialTier(2500, competitors);
  const noCompetitors = classifyInitialTier(2200, []);

  // None of these should ever return '2b'
  assert.notEqual(winning.tier, '2b');
  assert.notEqual(losing.tier, '2b');
  assert.notEqual(noCompetitors.tier, '2b');
});

test('classifyInitialTier: price conversion boundary — 0.005 cent rounding', () => {
  // Competitor: €22.005 → 2201 cents when rounded
  // Our price: 2201 cents (€22.01)
  // After Math.round(22.005 * 100) = 2201 (banker's rounding vs standard — JS rounds .5 up)
  const competitors = [{ total_price: 22.005 }];
  const result = classifyInitialTier(2201, competitors);
  // 2201 <= Math.round(22.005 * 100) = 2201 → Tier 2a
  assert.equal(result.tier, '2a');
});
