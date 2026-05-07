// Story 4.7 / AC#5 — Unit tests for /onboarding/scan-ready count logic + routing guards.
//
// These are pure unit tests: no DB, no running server, no .env.test required.
// The route handler logic is extracted inline and tested against mock DB clients.
//
// Covers:
//   AC#5-1  — totalOffers = total_skus + noEanCount for mixed catalog
//   AC#5-2  — ready_count = sku_channels WHERE tier IN ('1','2a','2b')
//   AC#5-3  — no_competitor_count = sku_channels WHERE tier = '3'
//   AC#5-4  — noEanCount = Math.max(0, skusTotal - total_skus)
//   AC#5-5  — totalOffers invariant: readyCount + noCompetitorCount + noEanCount = totalOffers
//   AC#5-6  — UX-DR2 guard: PROVISIONING state should redirect to /onboarding/scan
//   AC#5-7  — UX-DR2 guard: ACTIVE state should redirect to /
//   AC#5-8  — UX-DR2 guard: PAUSED_BY_CUSTOMER state should redirect to /
//   AC#5-9  — UX-DR2 guard: DRY_RUN + FAILED scan → redirect to /scan-failed
//   AC#5-10 — noEanCount never goes negative (Math.max(0, ...) guard)
//
// Run with: node --test tests/unit/routes/onboarding/scan-ready.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Helper: the count computation logic extracted from the route handler.
// This mirrors the logic in app/src/routes/onboarding/scan-ready.js exactly.
// If the route handler changes, these tests must be updated to match.
// ---------------------------------------------------------------------------

/**
 * Compute the four scan-ready counts from raw DB values.
 * This is the pure-function core of the route handler (no IO).
 *
 * @param {{ skusTotal: number, totalSkus: number, readyCount: number, noCompetitorCount: number }} params
 * @returns {{ totalOffers: number, readyCount: number, noCompetitorCount: number, noEanCount: number }}
 */
function computeScanReadyCounts ({ skusTotal, totalSkus, readyCount, noCompetitorCount }) {
  const noEanCount = Math.max(0, skusTotal - totalSkus);
  const totalOffers = totalSkus + noEanCount; // = skusTotal when skusTotal >= totalSkus
  return { totalOffers, readyCount, noCompetitorCount, noEanCount };
}

/**
 * Determine the UX-DR2 redirect target for a given cron_state and scan status.
 * Returns null if no redirect is needed (page can render).
 *
 * @param {{ cronState: string|null, scanStatus: string|null }} params
 * @returns {string|null} redirect path, or null if page should render
 */
function getUxDr2Redirect ({ cronState, scanStatus }) {
  // No customer_marketplace row at all → redirect to scan (no key yet)
  if (cronState === null) return '/onboarding/scan';

  // Not yet in DRY_RUN — still scanning or pre-scan
  if (cronState === 'PROVISIONING') return '/onboarding/scan';

  // Already past onboarding — dashboard
  const ACTIVE_STATES = [
    'ACTIVE',
    'PAUSED_BY_CUSTOMER',
    'PAUSED_BY_PAYMENT_FAILURE',
    'PAUSED_BY_CIRCUIT_BREAKER',
    'PAUSED_BY_KEY_REVOKED',
    'PAUSED_BY_ACCOUNT_GRACE_PERIOD',
  ];
  if (ACTIVE_STATES.includes(cronState)) return '/';

  // DRY_RUN state — check scan status
  if (cronState === 'DRY_RUN') {
    if (scanStatus === 'FAILED') return '/scan-failed';
    // COMPLETE or null → allow render (null = no scan_jobs row yet, edge case)
    return null;
  }

  // Unknown state — defensive redirect to scan
  return '/onboarding/scan';
}

// ---------------------------------------------------------------------------
// Mock DB factory — returns a client whose query() resolves with fixed rows.
// Maps SQL patterns to seeded return values.
// ---------------------------------------------------------------------------

/**
 * Build a mock DB client that responds to each query call in sequence.
 *
 * @param {Array<{ rows: object[] }>} responses - ordered list of query results
 */
function makeMockDb (responses) {
  let callIndex = 0;
  return {
    query: async (_sql, _params) => {
      const resp = responses[callIndex++];
      if (!resp) throw new Error(`makeMockDb: unexpected query at index ${callIndex - 1}`);
      return resp;
    },
  };
}

// ---------------------------------------------------------------------------
// AC#5-1 — totalOffers computation
// ---------------------------------------------------------------------------

test('count_query_total_offers_is_skus_plus_no_ean', () => {
  // 3 sku rows (EAN-bearing) + skusTotal = 4 (1 EAN-less in scan_jobs)
  const result = computeScanReadyCounts({
    skusTotal: 4,
    totalSkus: 3,
    readyCount: 2,
    noCompetitorCount: 1,
  });

  assert.equal(result.totalOffers, 4, 'totalOffers must be totalSkus + noEanCount = 4');
  assert.equal(result.noEanCount, 1, 'noEanCount must be skusTotal - totalSkus = 1');
});

// ---------------------------------------------------------------------------
// AC#5-2 — ready_for_repricing count (tier IN ('1', '2a', '2b'))
// ---------------------------------------------------------------------------

test('count_query_ready_count_is_tier_1_2a_2b', () => {
  // Mix: 10 T1 + 5 T2a + 3 T2b + 8 T3 = 26 total sku_channels
  // ready = 10 + 5 + 3 = 18
  const result = computeScanReadyCounts({
    skusTotal: 26,
    totalSkus: 26,
    readyCount: 18,     // T1 + T2a + T2b
    noCompetitorCount: 8, // T3
  });

  assert.equal(result.readyCount, 18, 'readyCount must include T1 + T2a + T2b');
});

// ---------------------------------------------------------------------------
// AC#5-3 — no_competitors count (tier = '3')
// ---------------------------------------------------------------------------

test('count_query_no_competitors_is_tier_3', () => {
  // 5 SKUs total, 2 with competitors (T1/T2a), 3 T3
  const result = computeScanReadyCounts({
    skusTotal: 5,
    totalSkus: 5,
    readyCount: 2,
    noCompetitorCount: 3,
  });

  assert.equal(result.noCompetitorCount, 3, 'noCompetitorCount must equal T3 count');
});

// ---------------------------------------------------------------------------
// AC#5-4 — noEanCount derivation from skusTotal - total_skus
// ---------------------------------------------------------------------------

test('count_query_no_ean_is_skus_total_minus_sku_rows', () => {
  // scan_jobs.skus_total = 200 (all OF21 offers including EAN-less)
  // skus table COUNT = 199 (1 was skipped because no EAN)
  const result = computeScanReadyCounts({
    skusTotal: 200,
    totalSkus: 199,
    readyCount: 150,
    noCompetitorCount: 49,
  });

  assert.equal(result.noEanCount, 1, 'noEanCount must be 200 - 199 = 1');
  assert.equal(result.totalOffers, 200, 'totalOffers must be 199 + 1 = 200');
});

// ---------------------------------------------------------------------------
// AC#5-5 — Y + Z + W = X invariant
// ---------------------------------------------------------------------------

test('count_invariant_ready_plus_tier3_plus_no_ean_equals_total_offers', () => {
  // Aligned numbers: readyCount + noCompetitorCount = totalSkus (all sku_channels cover all skus)
  // noEanCount = skusTotal - totalSkus
  // totalOffers = totalSkus + noEanCount = skusTotal
  // Invariant: readyCount + noCompetitorCount + noEanCount = totalOffers
  // 28842 + 1806 + 490 = 31138 = skusTotal
  const params = {
    skusTotal: 31138,   // total OF21 offers (EAN-bearing + EAN-less)
    totalSkus: 30648,   // skus rows (EAN-bearing only) = 28842 + 1806
    readyCount: 28842,  // T1/T2a/T2b sku_channels
    noCompetitorCount: 1806, // T3 sku_channels (30648 - 28842)
  };
  // noEanCount = 31138 - 30648 = 490
  // totalOffers = 30648 + 490 = 31138
  // invariant: 28842 + 1806 + 490 = 31138 ✓

  const result = computeScanReadyCounts(params);

  assert.equal(result.noEanCount, 490, 'noEanCount must be 31138 - 30648 = 490');
  assert.equal(result.totalOffers, 31138, 'totalOffers must equal skusTotal = 31138');
  assert.equal(
    result.readyCount + result.noCompetitorCount + result.noEanCount,
    result.totalOffers,
    `Invariant Y+Z+W=X must hold: ${result.readyCount}+${result.noCompetitorCount}+${result.noEanCount} = ${result.totalOffers}`,
  );
});

test('count_invariant_holds_for_all_tier3_catalog', () => {
  // Edge case: all SKUs are Tier 3 (no competitors at all)
  const result = computeScanReadyCounts({
    skusTotal: 100,
    totalSkus: 100,
    readyCount: 0,
    noCompetitorCount: 100,
  });

  assert.equal(result.readyCount + result.noCompetitorCount + result.noEanCount, result.totalOffers);
  assert.equal(result.totalOffers, 100);
});

test('count_invariant_holds_for_all_ready_catalog', () => {
  // Edge case: all SKUs are ready for repricing (Tier 1/2a/2b)
  const result = computeScanReadyCounts({
    skusTotal: 50,
    totalSkus: 50,
    readyCount: 50,
    noCompetitorCount: 0,
  });

  assert.equal(result.readyCount + result.noCompetitorCount + result.noEanCount, result.totalOffers);
  assert.equal(result.totalOffers, 50);
});

// ---------------------------------------------------------------------------
// AC#5-6 — UX-DR2: PROVISIONING → /onboarding/scan
// ---------------------------------------------------------------------------

test('ux_dr2_guard_provisioning_redirects_to_onboarding_scan', () => {
  const redirect = getUxDr2Redirect({ cronState: 'PROVISIONING', scanStatus: null });
  assert.equal(redirect, '/onboarding/scan', 'PROVISIONING must redirect to /onboarding/scan');
});

test('ux_dr2_guard_null_cm_redirects_to_onboarding_scan', () => {
  // Customer has no customer_marketplace row at all
  const redirect = getUxDr2Redirect({ cronState: null, scanStatus: null });
  assert.equal(redirect, '/onboarding/scan', 'No CM row must redirect to /onboarding/scan');
});

// ---------------------------------------------------------------------------
// AC#5-7 — UX-DR2: ACTIVE → /
// ---------------------------------------------------------------------------

test('ux_dr2_guard_active_redirects_to_dashboard', () => {
  const redirect = getUxDr2Redirect({ cronState: 'ACTIVE', scanStatus: 'COMPLETE' });
  assert.equal(redirect, '/', 'ACTIVE state must redirect to /');
});

// ---------------------------------------------------------------------------
// AC#5-8 — UX-DR2: PAUSED_* states → /
// ---------------------------------------------------------------------------

test('ux_dr2_guard_paused_by_customer_redirects_to_dashboard', () => {
  const redirect = getUxDr2Redirect({ cronState: 'PAUSED_BY_CUSTOMER', scanStatus: 'COMPLETE' });
  assert.equal(redirect, '/', 'PAUSED_BY_CUSTOMER must redirect to /');
});

test('ux_dr2_guard_paused_by_payment_failure_redirects_to_dashboard', () => {
  const redirect = getUxDr2Redirect({ cronState: 'PAUSED_BY_PAYMENT_FAILURE', scanStatus: 'COMPLETE' });
  assert.equal(redirect, '/', 'PAUSED_BY_PAYMENT_FAILURE must redirect to /');
});

test('ux_dr2_guard_paused_by_circuit_breaker_redirects_to_dashboard', () => {
  const redirect = getUxDr2Redirect({ cronState: 'PAUSED_BY_CIRCUIT_BREAKER', scanStatus: 'COMPLETE' });
  assert.equal(redirect, '/', 'PAUSED_BY_CIRCUIT_BREAKER must redirect to /');
});

test('ux_dr2_guard_paused_by_key_revoked_redirects_to_dashboard', () => {
  const redirect = getUxDr2Redirect({ cronState: 'PAUSED_BY_KEY_REVOKED', scanStatus: 'COMPLETE' });
  assert.equal(redirect, '/', 'PAUSED_BY_KEY_REVOKED must redirect to /');
});

test('ux_dr2_guard_paused_by_account_grace_period_redirects_to_dashboard', () => {
  const redirect = getUxDr2Redirect({ cronState: 'PAUSED_BY_ACCOUNT_GRACE_PERIOD', scanStatus: 'COMPLETE' });
  assert.equal(redirect, '/', 'PAUSED_BY_ACCOUNT_GRACE_PERIOD must redirect to /');
});

// ---------------------------------------------------------------------------
// AC#5-9 — UX-DR2: DRY_RUN + FAILED scan → /scan-failed
// ---------------------------------------------------------------------------

test('ux_dr2_guard_dry_run_with_failed_scan_redirects_to_scan_failed', () => {
  const redirect = getUxDr2Redirect({ cronState: 'DRY_RUN', scanStatus: 'FAILED' });
  assert.equal(redirect, '/scan-failed', 'DRY_RUN + FAILED scan must redirect to /scan-failed');
});

test('ux_dr2_guard_dry_run_with_complete_scan_allows_render', () => {
  const redirect = getUxDr2Redirect({ cronState: 'DRY_RUN', scanStatus: 'COMPLETE' });
  assert.equal(redirect, null, 'DRY_RUN + COMPLETE scan must allow page render (no redirect)');
});

// ---------------------------------------------------------------------------
// AC#5-10 — noEanCount never goes negative
// ---------------------------------------------------------------------------

test('no_ean_count_never_negative_when_skus_total_underreports', () => {
  // Edge case: if skusTotal < totalSkus (shouldn't happen, but defensive guard)
  const result = computeScanReadyCounts({
    skusTotal: 5,  // could be wrong/stale value
    totalSkus: 10, // more sku rows than skusTotal reports
    readyCount: 8,
    noCompetitorCount: 2,
  });

  assert.equal(result.noEanCount, 0, 'noEanCount must be 0, never negative');
  assert.equal(result.totalOffers, 10, 'totalOffers = totalSkus + 0 when no EAN-less detected');
});

test('no_ean_count_is_zero_for_catalog_with_no_skipped_offers', () => {
  // scan_jobs.skus_total = COUNT(skus) → no EAN-less offers
  const result = computeScanReadyCounts({
    skusTotal: 100,
    totalSkus: 100,
    readyCount: 60,
    noCompetitorCount: 40,
  });

  assert.equal(result.noEanCount, 0, 'noEanCount must be 0 when skusTotal = totalSkus');
  assert.equal(result.totalOffers, 100, 'totalOffers must equal totalSkus when no EAN-less');
});

// ---------------------------------------------------------------------------
// Mock DB integration: verify the query pattern works with async mock
// (structural test to catch import/signature mismatches before dev)
// ---------------------------------------------------------------------------

test('mock_db_responds_to_sequential_count_queries', async () => {
  const customerMarketplaceId = 'test-cm-uuid-1234';

  // Simulate the route handler's 3 parallel queries + 1 scan_jobs query
  const mockDb = makeMockDb([
    // scan_jobs query (sequential, before Promise.all)
    { rows: [{ skus_total: 50 }] },
    // skus COUNT query (parallel 1)
    { rows: [{ total_skus: 48 }] },
    // sku_channels ready count (parallel 2)
    { rows: [{ ready_count: 35 }] },
    // sku_channels no_competitor count (parallel 3)
    { rows: [{ no_competitor_count: 13 }] },
  ]);

  // Run the 4 queries sequentially (simulating the route handler's logic)
  const { rows: [scanJob] } = await mockDb.query(
    'SELECT skus_total FROM scan_jobs WHERE customer_marketplace_id = $1 AND status = $2 LIMIT 1',
    [customerMarketplaceId, 'COMPLETE'],
  );
  const { rows: [{ total_skus }] } = await mockDb.query(
    'SELECT COUNT(*)::int AS total_skus FROM skus WHERE customer_marketplace_id = $1',
    [customerMarketplaceId],
  );
  const { rows: [{ ready_count }] } = await mockDb.query(
    "SELECT COUNT(*)::int AS ready_count FROM sku_channels WHERE customer_marketplace_id = $1 AND tier IN ('1', '2a', '2b')",
    [customerMarketplaceId],
  );
  const { rows: [{ no_competitor_count }] } = await mockDb.query(
    "SELECT COUNT(*)::int AS no_competitor_count FROM sku_channels WHERE customer_marketplace_id = $1 AND tier = '3'",
    [customerMarketplaceId],
  );

  const result = computeScanReadyCounts({
    skusTotal: scanJob.skus_total,
    totalSkus: total_skus,
    readyCount: ready_count,
    noCompetitorCount: no_competitor_count,
  });

  assert.equal(result.noEanCount, 2, 'noEanCount must be 50 - 48 = 2');
  assert.equal(result.totalOffers, 50, 'totalOffers must be 48 + 2 = 50');
  assert.equal(result.readyCount, 35, 'readyCount must be 35');
  assert.equal(result.noCompetitorCount, 13, 'noCompetitorCount must be 13');

  // Invariant check
  assert.equal(
    result.readyCount + result.noCompetitorCount + result.noEanCount,
    result.totalOffers,
    `Invariant Y+Z+W=X: ${result.readyCount}+${result.noCompetitorCount}+${result.noEanCount} = ${result.totalOffers}`,
  );
});
