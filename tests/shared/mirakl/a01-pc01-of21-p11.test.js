/**
 * tests/shared/mirakl/a01-pc01-of21-p11.test.js
 *
 * Epic 3 — Story 3.2: Endpoint wrappers A01, PC01, OF21, P11 + Mirakl mock server
 * Coverage: AD5, AD13, AD14, AD16 partial; NFR-I1
 * SSoT modules: shared/mirakl/a01.js, pc01.js, of21.js, p11.js, self-filter.js
 * Mock server: tests/mocks/mirakl-server.js
 *
 * All tests run against the Mirakl mock server (tests/mocks/mirakl-server.js),
 * which replays fixture responses derived from verification-results.json.
 *
 * AC mapping
 * ──────────
 * AC1 → getAccount() shape + JSDoc typedef
 * AC2 → getPlatformConfiguration() shape + JSONB-preservable response
 * AC3 → getOffers() / getAllOffers() pagination
 * AC4 → getProductOffersByEan() / getProductOffersByEanBatch() P11 params
 * AC5 → mock server: fixture replay, 404 on unknown, failure injection
 * AC6 → wrapper tests against mock server; ESLint no-direct-fetch compliance
 * AC7 → self-filter.js filterCompetitorOffers AD13+AD14 filter chain
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Start the Mirakl mock server and return { mockServer, baseUrl }.
 * Each test should call mockServer.close() in its finally block.
 */
async function startMockServer () {
  const { createMiraklMockServer } = await import('../../mocks/mirakl-server.js');
  const mockServer = await createMiraklMockServer();
  return mockServer;
}

// ── AC5: mock server baseline ─────────────────────────────────────────────────

test('mock server — starts on a free port and returns baseUrl', async () => {
  const { mockServer, baseUrl } = await startMockServer();
  try {
    assert.ok(baseUrl.startsWith('http://127.0.0.1:'), 'baseUrl must be a localhost address');
    assert.ok(typeof mockServer.close === 'function', 'mockServer must have close()');
  } finally {
    await mockServer.close();
  }
});

test('mock server — returns 404 for unknown paths', async () => {
  const { mockServer, baseUrl } = await startMockServer();
  try {
    const res = await fetch(`${baseUrl}/api/unknown-endpoint`);
    assert.equal(res.status, 404, 'Unknown paths must return 404 so tests fail loudly');
  } finally {
    await mockServer.close();
  }
});

test('mock server — failure injection: injectError causes N failures then recovers', async () => {
  const { mockServer, baseUrl } = await startMockServer();
  try {
    mockServer.injectError({ path: '/api/account', status: 429, count: 2 });
    // First two calls should return 429
    const r1 = await fetch(`${baseUrl}/api/account`, {
      headers: { Authorization: 'test-key' },
    });
    assert.equal(r1.status, 429);
    const r2 = await fetch(`${baseUrl}/api/account`, {
      headers: { Authorization: 'test-key' },
    });
    assert.equal(r2.status, 429);
    // Third call should recover and return the fixture
    const r3 = await fetch(`${baseUrl}/api/account`, {
      headers: { Authorization: 'test-key' },
    });
    assert.equal(r3.status, 200);
  } finally {
    await mockServer.close();
  }
});

// ── AC1: A01 getAccount ───────────────────────────────────────────────────────

test('getAccount() — returns AccountInfo shape from mock fixture', async () => {
  const { mockServer, baseUrl } = await startMockServer();
  try {
    const { getAccount } = await import('../../../shared/mirakl/a01.js');
    const account = await getAccount(baseUrl, 'test-api-key');
    // Required fields per AccountInfo typedef
    assert.ok('shop_id' in account, 'Missing shop_id');
    assert.ok('shop_name' in account, 'Missing shop_name');
    assert.ok('shop_state' in account, 'Missing shop_state');
    assert.ok('currency_iso_code' in account, 'Missing currency_iso_code');
    assert.ok('is_professional' in account, 'Missing is_professional');
    assert.ok(Array.isArray(account.channels), 'channels must be an array');
    assert.ok(Array.isArray(account.domains), 'domains must be an array');
  } finally {
    await mockServer.close();
  }
});

test('getAccount() — fixture matches Easy-Store empirical values (shop_id 19706)', async () => {
  const { mockServer, baseUrl } = await startMockServer();
  try {
    const { getAccount } = await import('../../../shared/mirakl/a01.js');
    const account = await getAccount(baseUrl, 'test-api-key');
    // Fixture derived from verification-results.json (Easy-Store, 2026-04-30)
    assert.equal(account.shop_id, 19706, 'shop_id must match Easy-Store fixture');
    assert.equal(account.shop_name, 'Easy - Store', 'shop_name must match fixture');
    assert.equal(account.currency_iso_code, 'EUR', 'currency_iso_code must be EUR');
    assert.equal(account.shop_state, 'OPEN', 'shop_state must be OPEN');
  } finally {
    await mockServer.close();
  }
});

test('getAccount() — does NOT bypass api-client (no direct fetch())', async () => {
  // Read source and assert no direct fetch() call outside of import chain
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../../../shared/mirakl/a01.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('fetch('), 'a01.js must not call fetch() directly — use api-client.js');
});

// ── AC2: PC01 getPlatformConfiguration ───────────────────────────────────────

test('getPlatformConfiguration() — returns PC01 response with required fields', async () => {
  const { mockServer, baseUrl } = await startMockServer();
  try {
    const { getPlatformConfiguration } = await import('../../../shared/mirakl/pc01.js');
    const pc01 = await getPlatformConfiguration(baseUrl, 'test-api-key');
    // Required fields per epics spec AC2 (full flat shape)
    assert.ok('channel_pricing' in pc01, 'Missing channel_pricing');
    assert.ok('operator_csv_delimiter' in pc01, 'Missing operator_csv_delimiter');
    assert.ok('offer_prices_decimals' in pc01, 'Missing offer_prices_decimals');
    assert.ok('discount_period_required' in pc01, 'Missing discount_period_required');
    assert.ok('competitive_pricing_tool' in pc01, 'Missing competitive_pricing_tool');
    assert.ok('scheduled_pricing' in pc01, 'Missing scheduled_pricing');
    assert.ok('volume_pricing' in pc01, 'Missing volume_pricing');
    assert.ok('multi_currency' in pc01, 'Missing multi_currency');
    assert.ok('order_tax_mode' in pc01, 'Missing order_tax_mode');
    // Type lock-ins (AC2): offer_prices_decimals must be a number even though live API returns string
    assert.equal(typeof pc01.offer_prices_decimals, 'number', 'offer_prices_decimals must be number type');
    assert.equal(typeof pc01.discount_period_required, 'boolean', 'discount_period_required must be boolean');
    assert.equal(typeof pc01.competitive_pricing_tool, 'boolean', 'competitive_pricing_tool must be boolean');
  } finally {
    await mockServer.close();
  }
});

test('getPlatformConfiguration() — fixture matches Worten empirical values', async () => {
  const { mockServer, baseUrl } = await startMockServer();
  try {
    const { getPlatformConfiguration } = await import('../../../shared/mirakl/pc01.js');
    const pc01 = await getPlatformConfiguration(baseUrl, 'test-api-key');
    // Empirically verified against live Worten instance (verification-results.json)
    assert.equal(pc01.channel_pricing, 'SINGLE', 'Worten channel_pricing must be SINGLE (per AD6)');
    assert.equal(pc01.operator_csv_delimiter, 'SEMICOLON', 'Worten operator_csv_delimiter must be SEMICOLON (per AD7)');
    assert.equal(pc01.offer_prices_decimals, 2, 'Worten offer_prices_decimals must be 2');
    assert.equal(pc01.discount_period_required, false, 'Worten discount_period_required must be false');
  } finally {
    await mockServer.close();
  }
});

test('getPlatformConfiguration() — returns full response preservable as JSONB', async () => {
  // The full PC01 response must be JSON-serializable for
  // customer_marketplaces.platform_features_snapshot JSONB storage.
  const { mockServer, baseUrl } = await startMockServer();
  try {
    const { getPlatformConfiguration } = await import('../../../shared/mirakl/pc01.js');
    const pc01 = await getPlatformConfiguration(baseUrl, 'test-api-key');
    const serialized = JSON.stringify(pc01);
    const reparsed = JSON.parse(serialized);
    assert.deepEqual(pc01, reparsed, 'PC01 response must survive JSON round-trip for JSONB storage');
  } finally {
    await mockServer.close();
  }
});

// ── AC3: OF21 getOffers / getAllOffers ────────────────────────────────────────

test('getOffers() — returns offers array with required fields', async () => {
  const { mockServer, baseUrl } = await startMockServer();
  try {
    const { getOffers } = await import('../../../shared/mirakl/of21.js');
    const { offers, pageToken } = await getOffers(baseUrl, 'test-api-key', {});
    assert.ok(Array.isArray(offers), 'offers must be an array');
    assert.ok(pageToken === null || typeof pageToken === 'number', 'pageToken must be number or null');
    // The fixture is non-empty (asserted in the next test), so shape assertions
    // run unconditionally — no `if (offers.length > 0)` guard.
    assert.ok(offers.length > 0, 'OF21 fixture must yield at least one offer for shape assertion');
    const offer = offers[0];
    assert.ok('shop_sku' in offer, 'Missing shop_sku');
    assert.ok('product_sku' in offer, 'Missing product_sku');
    assert.ok('price' in offer, 'Missing price');
    assert.ok('total_price' in offer, 'Missing total_price');
    assert.ok('quantity' in offer, 'Missing quantity');
    assert.ok('channels' in offer, 'Missing channels');
    assert.ok('product_references' in offer, 'Missing product_references');
    assert.equal(typeof offer.active, 'boolean', 'active must be boolean');
  } finally {
    await mockServer.close();
  }
});

test('getOffers() — fixture has at least 1 offer with shop_sku populated', async () => {
  const { mockServer, baseUrl } = await startMockServer();
  try {
    const { getOffers } = await import('../../../shared/mirakl/of21.js');
    const { offers } = await getOffers(baseUrl, 'test-api-key', {});
    assert.ok(offers.length >= 1, 'OF21 fixture must have at least 1 offer');
    assert.ok(offers.some(o => o.shop_sku), 'At least one offer must have shop_sku populated');
  } finally {
    await mockServer.close();
  }
});

test('getAllOffers() — iterates all pages until exhaustion', async () => {
  const { mockServer, baseUrl } = await startMockServer();
  try {
    const { getAllOffers, getOffers } = await import('../../../shared/mirakl/of21.js');
    const allOffers = await getAllOffers(baseUrl, 'test-api-key');
    assert.ok(Array.isArray(allOffers), 'getAllOffers must return an array');
    // First page contract: pageToken === null when total_count is reached.
    const firstPage = await getOffers(baseUrl, 'test-api-key', {});
    assert.equal(allOffers.length, firstPage.offers.length, 'getAllOffers must equal first-page length when fixture fits one page');
    // Aggregated list must match total_count from the fixture (exhaustion proof).
    assert.equal(allOffers.length, 2, 'Mock fixture has total_count=2; loop must terminate after collecting both');
    assert.equal(firstPage.pageToken, null, 'pageToken must be null when first page already satisfies total_count');
  } finally {
    await mockServer.close();
  }
});

test('getOffers() — pageToken signals next offset when more pages exist', async () => {
  // Lock in the offset-based pagination contract: when offers.length < total_count,
  // pageToken === offset + offers.length (integer next offset).
  const { mockServer, baseUrl } = await startMockServer();
  try {
    const { getOffers } = await import('../../../shared/mirakl/of21.js');
    // First page: offset 0, pageSize 1 → offers.length 1, total_count 2 → pageToken=1
    const page1 = await getOffers(baseUrl, 'test-api-key', { offset: 0, pageSize: 1 });
    // Mock returns full fixture for offset=0 regardless of pageSize, so the
    // wrapper computes nextOffset from offers.length vs total_count.
    if (page1.offers.length < 2) {
      assert.equal(page1.pageToken, page1.offers.length, 'pageToken must equal next offset (integer) when more pages exist');
    } else {
      // Single-page case: fixture exhausted in one call.
      assert.equal(page1.pageToken, null, 'pageToken must be null when exhausted');
    }
  } finally {
    await mockServer.close();
  }
});

test('getOffers() — does NOT bypass api-client (no direct fetch())', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../../../shared/mirakl/of21.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('fetch('), 'of21.js must not call fetch() directly — use api-client.js');
});

// ── AC4: P11 getProductOffersByEan / batch ────────────────────────────────────

test('getProductOffersByEan() — issues correct P11 GET params', async () => {
  const { mockServer, baseUrl } = await startMockServer();
  let capturedParams;
  // Capture the query string of the next /api/products/offers request
  mockServer.captureNextRequest('/api/products/offers', (params) => { capturedParams = params; });
  try {
    const { getProductOffersByEan } = await import('../../../shared/mirakl/p11.js');
    // Must not throw — mock server returns a valid fixture for any P11 query.
    await getProductOffersByEan(baseUrl, 'test-api-key', {
      ean: '8809606851663',
      channel: 'WRT_PT_ONLINE',
      pricingChannelCode: 'WRT_PT_ONLINE',
    });
    // Capture MUST have fired — otherwise the wrapper bypassed the mock or the
    // capture API is broken. Both are fail conditions, not soft passes.
    assert.ok(capturedParams, 'captureNextRequest callback must fire — wrapper must hit mock server');
    assert.ok(capturedParams.product_references?.includes('EAN|8809606851663'), 'product_references must use EAN| prefix');
    assert.ok(capturedParams.channel_codes?.includes('WRT_PT_ONLINE'), 'channel_codes param missing');
    assert.ok(capturedParams.pricing_channel_code?.includes('WRT_PT_ONLINE'), 'pricing_channel_code param missing');
  } finally {
    await mockServer.close();
  }
});

test('getProductOffersByEanBatch() — concatenates up to 100 EANs as EAN|x,EAN|y,...', async () => {
  const { mockServer, baseUrl } = await startMockServer();
  let capturedParams;
  mockServer.captureNextRequest('/api/products/offers', (params) => { capturedParams = params; });
  try {
    const { getProductOffersByEanBatch } = await import('../../../shared/mirakl/p11.js');
    const eans = ['1111111111111', '2222222222222', '3333333333333'];
    await getProductOffersByEanBatch(baseUrl, 'test-api-key', {
      eans,
      channel: 'WRT_PT_ONLINE',
    });
    // Capture MUST have fired — turn the previously-conditional assertion into a hard one.
    assert.ok(capturedParams, 'captureNextRequest callback must fire — wrapper must hit mock server');
    const productRefs = capturedParams.product_references ?? '';
    for (const ean of eans) {
      assert.ok(productRefs.includes(`EAN|${ean}`), `product_references must include EAN|${ean}`);
    }
    // Lock in the comma-separated concatenation contract.
    assert.equal(productRefs, eans.map(e => `EAN|${e}`).join(','), 'EAN list must be comma-joined in encounter order');
  } finally {
    await mockServer.close();
  }
});

test('getProductOffersByEanBatch() — accepts up to 100 EANs per call', async () => {
  // Behavioral: does not throw when called with 100 EANs
  const { mockServer, baseUrl } = await startMockServer();
  try {
    const { getProductOffersByEanBatch } = await import('../../../shared/mirakl/p11.js');
    const eans = Array.from({ length: 100 }, (_, i) => String(i).padStart(13, '0'));
    // Should not throw — may return empty products array if mock has no fixture for these EANs
    await assert.doesNotReject(
      () => getProductOffersByEanBatch(baseUrl, 'test-api-key', { eans, channel: 'WRT_PT_ONLINE' }),
      'getProductOffersByEanBatch must accept 100 EANs without throwing'
    );
  } finally {
    await mockServer.close();
  }
});

test('getProductOffersByEan() — returns raw offer list (filtering done by self-filter)', async () => {
  const { mockServer, baseUrl } = await startMockServer();
  try {
    const { getProductOffersByEan } = await import('../../../shared/mirakl/p11.js');
    // Mock fixture FIXTURE_P11_PT covers WRT_PT_ONLINE — call must succeed.
    const result = await getProductOffersByEan(baseUrl, 'test-api-key', {
      ean: '8809606851663',
      channel: 'WRT_PT_ONLINE',
      pricingChannelCode: 'WRT_PT_ONLINE',
    });
    assert.ok(Array.isArray(result), 'getProductOffersByEan must return an array of offers');
    // Must be raw — no filtering applied. Confirm the own-shop offer is still present
    // in the result; self-filter.js (not p11.js) is the layer that removes it.
    assert.ok(result.length >= 1, 'Mock fixture must yield offers for the captured EAN');
    assert.ok(result.some(o => o.shop_name === 'Easy - Store'), 'Own-shop offer must NOT be filtered by p11.js — self-filter.js is responsible');
  } finally {
    await mockServer.close();
  }
});

test('p11.js — does NOT bypass api-client (no direct fetch())', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../../../shared/mirakl/p11.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('fetch('), 'p11.js must not call fetch() directly — use api-client.js');
});

// ── AC7: self-filter.js filterCompetitorOffers ────────────────────────────────

test('self-filter — filters out inactive offers (o.active !== true)', async () => {
  const { filterCompetitorOffers } = await import('../../../shared/mirakl/self-filter.js');
  const rawOffers = [
    { shop_name: 'Competitor A', active: true,  total_price: 29.99 },
    { shop_name: 'Competitor B', active: false, total_price: 19.99 },
    { shop_name: 'Competitor C', active: true,  total_price: 24.99 },
  ];
  const { filteredOffers } = filterCompetitorOffers(rawOffers, 'My Store');
  assert.ok(filteredOffers.every(o => o.active === true), 'Inactive offers must be filtered out');
  assert.equal(filteredOffers.length, 2);
});

test('self-filter — filters out zero-price placeholder offers (total_price === 0)', async () => {
  const { filterCompetitorOffers } = await import('../../../shared/mirakl/self-filter.js');
  const rawOffers = [
    { shop_name: 'Strawberrynet', active: true, total_price: 0 },     // placeholder
    { shop_name: 'Competitor A',  active: true, total_price: 29.99 },
  ];
  const { filteredOffers } = filterCompetitorOffers(rawOffers, 'My Store');
  assert.ok(!filteredOffers.some(o => o.total_price === 0), 'Zero-price placeholders must be filtered out');
  assert.equal(filteredOffers.length, 1);
});

test('self-filter — filters out own-shop offers by shop_name', async () => {
  const { filterCompetitorOffers } = await import('../../../shared/mirakl/self-filter.js');
  const ownShopName = 'Easy - Store';
  const rawOffers = [
    { shop_name: ownShopName,    active: true, total_price: 25.00 },
    { shop_name: 'Competitor A', active: true, total_price: 29.99 },
  ];
  const { filteredOffers } = filterCompetitorOffers(rawOffers, ownShopName);
  assert.ok(!filteredOffers.some(o => o.shop_name === ownShopName), 'Own-shop must be filtered out');
  assert.equal(filteredOffers.length, 1);
});

test('self-filter — sorts filtered offers ascending by total_price', async () => {
  const { filterCompetitorOffers } = await import('../../../shared/mirakl/self-filter.js');
  const rawOffers = [
    { shop_name: 'B', active: true, total_price: 30.00 },
    { shop_name: 'A', active: true, total_price: 20.00 },
    { shop_name: 'C', active: true, total_price: 25.00 },
  ];
  const { filteredOffers } = filterCompetitorOffers(rawOffers, 'My Store');
  for (let i = 1; i < filteredOffers.length; i++) {
    assert.ok(
      filteredOffers[i].total_price >= filteredOffers[i - 1].total_price,
      `Offers must be sorted ascending by total_price; index ${i} is out of order`
    );
  }
});

test('self-filter — filter chain order: active → positive → not-own → sort', async () => {
  const { filterCompetitorOffers } = await import('../../../shared/mirakl/self-filter.js');
  const ownShopName = 'My Store';
  const rawOffers = [
    { shop_name: 'Inactive',   active: false, total_price: 10.00 },
    { shop_name: 'ZeroPrice',  active: true,  total_price: 0 },
    { shop_name: ownShopName,  active: true,  total_price: 15.00 },
    { shop_name: 'B',          active: true,  total_price: 30.00 },
    { shop_name: 'A',          active: true,  total_price: 20.00 },
  ];
  const { filteredOffers } = filterCompetitorOffers(rawOffers, ownShopName);
  assert.equal(filteredOffers.length, 2, 'After full filter chain: 2 valid competitors remain');
  assert.equal(filteredOffers[0].shop_name, 'A', 'First offer must be cheapest competitor');
  assert.equal(filteredOffers[1].shop_name, 'B', 'Second offer must be second-cheapest competitor');
});

test('self-filter — collision detection: collisionDetected true when >1 offer matches ownShopName', async () => {
  const { filterCompetitorOffers } = await import('../../../shared/mirakl/self-filter.js');
  const ownShopName = 'Easy - Store';
  const rawOffers = [
    { shop_name: ownShopName, active: true, total_price: 25.00 },
    { shop_name: ownShopName, active: true, total_price: 22.00 },  // collision
    { shop_name: 'Competitor', active: true, total_price: 28.00 },
  ];
  const { collisionDetected } = filterCompetitorOffers(rawOffers, ownShopName);
  assert.equal(collisionDetected, true, 'collisionDetected must be true when >1 offer has own shop_name');
});

test('self-filter — collision detection: collisionDetected false for normal case', async () => {
  const { filterCompetitorOffers } = await import('../../../shared/mirakl/self-filter.js');
  const rawOffers = [
    { shop_name: 'Easy - Store', active: true, total_price: 25.00 },
    { shop_name: 'Competitor',   active: true, total_price: 28.00 },
  ];
  const { collisionDetected } = filterCompetitorOffers(rawOffers, 'Easy - Store');
  assert.equal(collisionDetected, false, 'collisionDetected must be false with at most 1 own-shop offer');
});

test('self-filter — empty-after-filter returns empty array (caller handles Tier 3)', async () => {
  const { filterCompetitorOffers } = await import('../../../shared/mirakl/self-filter.js');
  const rawOffers = [
    { shop_name: 'Easy - Store', active: true, total_price: 25.00 }, // own
    { shop_name: 'Inactive',     active: false, total_price: 15.00 }, // inactive
  ];
  const { filteredOffers } = filterCompetitorOffers(rawOffers, 'Easy - Store');
  assert.equal(filteredOffers.length, 0, 'Empty-after-filter must return empty array, not throw');
});

test('self-filter — non-finite total_price is filtered out', async () => {
  const { filterCompetitorOffers } = await import('../../../shared/mirakl/self-filter.js');
  const rawOffers = [
    { shop_name: 'A', active: true, total_price: NaN },
    { shop_name: 'B', active: true, total_price: Infinity },
    { shop_name: 'C', active: true, total_price: 29.99 },
  ];
  const { filteredOffers } = filterCompetitorOffers(rawOffers, 'My Store');
  assert.ok(!filteredOffers.some(o => !Number.isFinite(o.total_price)), 'Non-finite prices must be filtered out');
  assert.equal(filteredOffers.length, 1);
});

// ── AC6: ESLint no-direct-fetch compliance for all wrappers ──────────────────

test('ESLint no-direct-fetch: codebase scan — no direct fetch() outside shared/mirakl/', async () => {
  // Smoke-test: grep source tree for `fetch(` outside the allowed directory
  // This test is informational — it catches accidental fetch() calls introduced
  // by future stories before the ESLint CI hook runs.
  async function findJsFiles (dir) {
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && !['node_modules', '.git', 'tests'].includes(entry.name)) {
        files.push(...await findJsFiles(full));
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(full);
      }
    }
    return files;
  }
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { join, dirname, relative } = await import('node:path');
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  const srcDirs = [
    join(projectRoot, 'app'),
    join(projectRoot, 'worker'),
    join(projectRoot, 'shared'),
  ];
  const violations = [];
  for (const dir of srcDirs) {
    let files;
    try { files = await findJsFiles(dir); } catch { continue; }
    for (const file of files) {
      const rel = relative(projectRoot, file).replace(/\\/g, '/');
      // Allow shared/mirakl/ directory
      if (rel.startsWith('shared/mirakl/')) continue;
      const src = await readFile(file, 'utf8');
      if (/\bfetch\s*\(/.test(src)) {
        violations.push(rel);
      }
    }
  }
  assert.deepEqual(violations, [], `Direct fetch() calls found outside shared/mirakl/:\n${violations.join('\n')}`);
});
