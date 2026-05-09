// tests/shared/mirakl/pri01-writer.test.js
// Epic 6 Test Plan — Story 6.1 scaffold (epic-start-test-design 2026-05-08)
// Runner: node --test (built-in; no Jest/Vitest per architecture constraint)
//
// Coverage:
//   AC#1 — buildPri01Csv: delimiter, price formatting, shop_sku, passthrough lines, channels, golden fixtures
//   AC#2 — submitPriceImport: endpoint, auth header, return shape, error mapping, retry behavior, key safety
//   AC#3 — markStagingPending: atomicity, pending_import_id propagation, flushed_at, Bundle C invariant
//   AC#4 — ESLint no-raw-CSV-building rule: violation detection, allowlist, CSV-read false-positive guard
//   AC#5 — PC01 capture completeness: null delimiter / null offerPricesDecimals → clear error with customer_id

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../..');
const fixturesDir = join(repoRoot, 'tests/fixtures/pri01-csv');

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------
import { buildPri01Csv, submitPriceImport, markStagingPending } from '../../../shared/mirakl/pri01-writer.js';

// ---------------------------------------------------------------------------
// AC#1 — buildPri01Csv
// ---------------------------------------------------------------------------

describe('buildPri01Csv', () => {
  const baseSkuChannel = {
    shopSku: 'EZ8809606851663',
    channelCode: 'WRT_PT_ONLINE',
    newPriceCents: 1799,
    lastSetPriceCents: 2000,
  };

  it('build_pri01_csv_produces_correct_header_row', () => {
    const { csvBody } = buildPri01Csv({
      skuChannels: [baseSkuChannel],
      operatorCsvDelimiter: 'SEMICOLON',
      offerPricesDecimals: 2,
      customerMarketplaceId: 'cm-test-001',
    });
    const firstLine = csvBody.split('\n')[0];
    assert.strictEqual(firstLine, 'offer-sku;price;channels');
  });

  it('build_pri01_csv_uses_semicolon_delimiter_from_parameter', () => {
    const { csvBody } = buildPri01Csv({
      skuChannels: [baseSkuChannel],
      operatorCsvDelimiter: 'SEMICOLON',
      offerPricesDecimals: 2,
      customerMarketplaceId: 'cm-test-001',
    });
    const lines = csvBody.split('\n');
    // Header and body lines should use semicolons
    assert.ok(lines[0].includes(';'), 'Header should contain semicolons');
    assert.ok(lines[1].includes(';'), 'Body line should contain semicolons');
    assert.ok(!lines[1].includes(','), 'Body line should NOT contain commas as delimiter');
  });

  it('build_pri01_csv_uses_comma_delimiter_from_parameter', () => {
    const { csvBody } = buildPri01Csv({
      skuChannels: [baseSkuChannel],
      operatorCsvDelimiter: 'COMMA',
      offerPricesDecimals: 2,
      customerMarketplaceId: 'cm-test-001',
    });
    const firstLine = csvBody.split('\n')[0];
    assert.strictEqual(firstLine, 'offer-sku,price,channels');
    const bodyLine = csvBody.split('\n')[1];
    assert.ok(bodyLine.includes(','), 'Body line should contain commas');
  });

  it('build_pri01_csv_throws_on_null_delimiter', () => {
    assert.throws(
      () => buildPri01Csv({
        skuChannels: [baseSkuChannel],
        operatorCsvDelimiter: null,
        offerPricesDecimals: 2,
        customerMarketplaceId: 'cm-test-null-delim',
      }),
      /PC01 capture incomplete/,
    );
  });

  it('build_pri01_csv_throws_on_undefined_delimiter', () => {
    assert.throws(
      () => buildPri01Csv({
        skuChannels: [baseSkuChannel],
        operatorCsvDelimiter: undefined,
        offerPricesDecimals: 2,
        customerMarketplaceId: 'cm-test-undef-delim',
      }),
      /PC01 capture incomplete/,
    );
  });

  it('build_pri01_csv_formats_price_with_offer_prices_decimals', () => {
    const { csvBody } = buildPri01Csv({
      skuChannels: [{ ...baseSkuChannel, newPriceCents: 1799 }],
      operatorCsvDelimiter: 'SEMICOLON',
      offerPricesDecimals: 2,
      customerMarketplaceId: 'cm-test-001',
    });
    const bodyLine = csvBody.split('\n')[1];
    // Should contain 17.99 with ASCII period
    assert.ok(bodyLine.includes('17.99'), `Expected 17.99 in body line, got: ${bodyLine}`);
    // Must use ASCII period, not comma
    assert.ok(!bodyLine.includes('17,99'), 'Should not use comma as decimal separator');
  });

  it('build_pri01_csv_throws_on_null_offer_prices_decimals', () => {
    assert.throws(
      () => buildPri01Csv({
        skuChannels: [baseSkuChannel],
        operatorCsvDelimiter: 'SEMICOLON',
        offerPricesDecimals: null,
        customerMarketplaceId: 'cm-test-null-dec',
      }),
      /PC01 capture incomplete/,
    );
  });

  it('build_pri01_csv_uses_shop_sku_not_product_sku', () => {
    const ch = {
      shopSku: 'EZ8809606851663',
      productSku: 'MIRAKL-INTERNAL-UUID',
      channelCode: 'WRT_PT_ONLINE',
      newPriceCents: 1799,
      lastSetPriceCents: 2000,
    };
    const { csvBody } = buildPri01Csv({
      skuChannels: [ch],
      operatorCsvDelimiter: 'SEMICOLON',
      offerPricesDecimals: 2,
      customerMarketplaceId: 'cm-test-001',
    });
    const bodyLine = csvBody.split('\n')[1];
    assert.ok(bodyLine.startsWith('EZ8809606851663;'), `offer-sku should be shopSku, got: ${bodyLine}`);
    assert.ok(!bodyLine.includes('MIRAKL-INTERNAL-UUID'), 'Should NOT use productSku');
  });

  it('build_pri01_csv_includes_passthrough_lines_for_unchanged_channels', () => {
    // 2-channel SKU: PT has new price (UNDERCUT), ES has NO new decision (passthrough)
    const channels = [
      { shopSku: 'EZ8809606851663', channelCode: 'WRT_PT_ONLINE', newPriceCents: 1799, lastSetPriceCents: 2000 },
      { shopSku: 'EZ8809606851663', channelCode: 'WRT_ES_ONLINE', newPriceCents: null, lastSetPriceCents: 2000 },
    ];
    const { csvBody } = buildPri01Csv({
      skuChannels: channels,
      operatorCsvDelimiter: 'SEMICOLON',
      offerPricesDecimals: 2,
      customerMarketplaceId: 'cm-test-001',
    });
    const lines = csvBody.split('\n').filter(l => l.length > 0);
    // header + 2 body lines
    assert.strictEqual(lines.length, 3, `Expected 3 lines (header + 2 body), got: ${lines.length}`);
    // ES passthrough at lastSetPriceCents = 2000 → 20.00
    assert.ok(csvBody.includes('WRT_ES_ONLINE'), 'Passthrough channel must be included');
    assert.ok(csvBody.includes('20.00'), 'Passthrough channel should use lastSetPriceCents (20.00)');
  });

  it('build_pri01_csv_channels_column_is_pipe_separated', () => {
    // Single channel: channels = 'WRT_PT_ONLINE' (no pipe needed)
    const { csvBody } = buildPri01Csv({
      skuChannels: [baseSkuChannel],
      operatorCsvDelimiter: 'SEMICOLON',
      offerPricesDecimals: 2,
      customerMarketplaceId: 'cm-test-001',
    });
    const bodyLine = csvBody.split('\n')[1];
    const parts = bodyLine.split(';');
    assert.strictEqual(parts[2], 'WRT_PT_ONLINE', `channels column should be 'WRT_PT_ONLINE', got: ${parts[2]}`);
  });

  it('build_pri01_csv_returns_line_map_mapping_1_based_body_lines_to_shop_skus', () => {
    // Story 6.3's PRI03 parser depends on this contract: the writer must return
    // a lineMap that maps 1-based body row numbers (excluding header) → shopSku
    // so failed CSV lines from Mirakl's error report can be correlated back to
    // the SKU. Without this the AC#1 return-shape contract regresses silently
    // and Story 6.3 breaks. Per Notes-for-Amelia #8 in epic-6-test-plan.md.
    const channels = [
      { shopSku: 'EZ-SKU-A', channelCode: 'WRT_PT_ONLINE', newPriceCents: 1000, lastSetPriceCents: 1000 },
      { shopSku: 'EZ-SKU-A', channelCode: 'WRT_ES_ONLINE', newPriceCents: null, lastSetPriceCents: 2000 },
      { shopSku: 'EZ-SKU-A', channelCode: 'WRT_FR_ONLINE', newPriceCents: 3000, lastSetPriceCents: 3500 },
    ];
    const result = buildPri01Csv({
      skuChannels: channels,
      operatorCsvDelimiter: 'SEMICOLON',
      offerPricesDecimals: 2,
      customerMarketplaceId: 'cm-test-line-map',
    });
    // Result must include lineMap as an object on the return value
    assert.ok(Object.prototype.hasOwnProperty.call(result, 'lineMap'), 'Return value must include lineMap');
    assert.strictEqual(typeof result.lineMap, 'object', 'lineMap must be an object');
    // lineMap is 1-based, body rows only (header excluded)
    // Three body lines → keys 1, 2, 3 → all three map to 'EZ-SKU-A'
    assert.strictEqual(result.lineMap[1], 'EZ-SKU-A', 'Line 1 must map to first body row shopSku');
    assert.strictEqual(result.lineMap[2], 'EZ-SKU-A', 'Line 2 must map to second body row shopSku');
    assert.strictEqual(result.lineMap[3], 'EZ-SKU-A', 'Line 3 must map to third body row shopSku');
    // Header is not part of lineMap (no key 0)
    assert.strictEqual(result.lineMap[0], undefined, 'lineMap must not include header line (1-based, body only)');
  });

  it('build_pri01_csv_matches_single_channel_undercut_golden_fixture', () => {
    // single-channel-undercut.csv: EZ8809606851663;17.99;WRT_PT_ONLINE (LF, no BOM)
    const expected = readFileSync(join(fixturesDir, 'single-channel-undercut.csv'), 'utf-8');
    const { csvBody } = buildPri01Csv({
      skuChannels: [
        { shopSku: 'EZ8809606851663', channelCode: 'WRT_PT_ONLINE', newPriceCents: 1799, lastSetPriceCents: 2000 },
      ],
      operatorCsvDelimiter: 'SEMICOLON',
      offerPricesDecimals: 2,
      customerMarketplaceId: 'cm-test-001',
    });
    assert.strictEqual(csvBody, expected, 'CSV should match single-channel-undercut golden fixture byte-exact');
  });

  it('build_pri01_csv_matches_multi_channel_passthrough_golden_fixture', () => {
    // multi-channel-passthrough.csv: PT at 17.99, ES passthrough at 20.00
    const expected = readFileSync(join(fixturesDir, 'multi-channel-passthrough.csv'), 'utf-8');
    const { csvBody } = buildPri01Csv({
      skuChannels: [
        { shopSku: 'EZ8809606851663', channelCode: 'WRT_PT_ONLINE', newPriceCents: 1799, lastSetPriceCents: 2000 },
        { shopSku: 'EZ8809606851663', channelCode: 'WRT_ES_ONLINE', newPriceCents: null, lastSetPriceCents: 2000 },
      ],
      operatorCsvDelimiter: 'SEMICOLON',
      offerPricesDecimals: 2,
      customerMarketplaceId: 'cm-test-001',
    });
    assert.strictEqual(csvBody, expected, 'CSV should match multi-channel-passthrough golden fixture byte-exact');
  });

  it('build_pri01_csv_matches_pri03_recovery_resubmit_golden_fixture', () => {
    // pri03-recovery-resubmit.csv: full SKU rebuild after PRI03 failure
    // Both channels at corrected prices: PT 17.99, ES 18.50
    const expected = readFileSync(join(fixturesDir, 'pri03-recovery-resubmit.csv'), 'utf-8');
    const { csvBody } = buildPri01Csv({
      skuChannels: [
        { shopSku: 'EZ8809606851663', channelCode: 'WRT_PT_ONLINE', newPriceCents: 1799, lastSetPriceCents: 2000 },
        { shopSku: 'EZ8809606851663', channelCode: 'WRT_ES_ONLINE', newPriceCents: 1850, lastSetPriceCents: 2000 },
      ],
      operatorCsvDelimiter: 'SEMICOLON',
      offerPricesDecimals: 2,
      customerMarketplaceId: 'cm-test-001',
    });
    assert.strictEqual(csvBody, expected, 'CSV should match pri03-recovery-resubmit golden fixture byte-exact');
  });
});

// ---------------------------------------------------------------------------
// AC#2 — submitPriceImport
// ---------------------------------------------------------------------------

describe('submitPriceImport', () => {
  it('submit_price_import_posts_to_correct_endpoint', async () => {
    let capturedUrl, capturedMethod;
    const mockFetch = mock.fn(async (url, opts) => {
      capturedUrl = url;
      capturedMethod = opts.method;
      return new Response(JSON.stringify({ import_id: 'test-import-id' }), { status: 200 });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      await submitPriceImport('https://worten.mirakl.net', 'test-key', 'offer-sku;price;channels\n');
      assert.strictEqual(capturedUrl, 'https://worten.mirakl.net/api/offers/pricing/imports');
      assert.strictEqual(capturedMethod, 'POST');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('submit_price_import_uses_raw_authorization_header_no_bearer', async () => {
    let capturedHeaders;
    const mockFetch = mock.fn(async (_url, opts) => {
      capturedHeaders = opts.headers;
      return new Response(JSON.stringify({ import_id: 'test-import-id' }), { status: 200 });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      await submitPriceImport('https://worten.mirakl.net', 'MY-RAW-API-KEY', 'offer-sku;price;channels\n');
      assert.strictEqual(capturedHeaders.Authorization, 'MY-RAW-API-KEY', 'Authorization header must be raw key, no Bearer prefix');
      assert.ok(!String(capturedHeaders.Authorization).startsWith('Bearer '), 'Must NOT have Bearer prefix');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('submit_price_import_returns_import_id_on_success', async () => {
    const mockFetch = mock.fn(async () => {
      return new Response(JSON.stringify({ import_id: 'uuid-import-abc-123' }), { status: 200 });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      const result = await submitPriceImport('https://worten.mirakl.net', 'test-key', 'offer-sku;price;channels\n');
      assert.deepStrictEqual(result, { importId: 'uuid-import-abc-123' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('submit_price_import_throws_mirakl_api_error_on_failure', async () => {
    const mockFetch = mock.fn(async () => {
      return new Response('Unprocessable Entity', { status: 422 });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      await assert.rejects(
        () => submitPriceImport('https://worten.mirakl.net', 'test-key', 'bad-csv'),
        (err) => {
          assert.strictEqual(err.name, 'MiraklApiError');
          assert.ok(err.safeMessagePt, 'Should have safeMessagePt');
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('submit_price_import_does_not_leak_api_key_in_error', async () => {
    const secretKey = 'SECRET-KEY-12345';
    const mockFetch = mock.fn(async () => {
      return new Response('Bad Request', { status: 400 });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      let caughtError;
      try {
        await submitPriceImport('https://worten.mirakl.net', secretKey, 'csv-body');
      } catch (err) {
        caughtError = err;
      }
      assert.ok(caughtError, 'Should have thrown');
      assert.ok(!caughtError.message.includes(secretKey), 'Error message must not contain apiKey');
      assert.ok(!caughtError.stack.includes(secretKey), 'Stack trace must not contain apiKey');
      const serialized = JSON.stringify(caughtError);
      assert.ok(!serialized.includes(secretKey), 'Serialized error must not contain apiKey');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('submit_price_import_retries_on_429', async () => {
    let callCount = 0;
    const mockFetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Too Many Requests', { status: 429 });
      }
      return new Response(JSON.stringify({ import_id: 'retry-import-id' }), { status: 200 });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    // Patch backoff to be instant for tests
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, _ms) => originalSetTimeout(fn, 0);
    try {
      const result = await submitPriceImport('https://worten.mirakl.net', 'test-key', 'csv-body');
      assert.deepStrictEqual(result, { importId: 'retry-import-id' });
      assert.strictEqual(callCount, 2, 'fetch should have been called twice (1 fail + 1 retry)');
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  it('submit_price_import_retries_on_5xx', async () => {
    let callCount = 0;
    const mockFetch = mock.fn(async () => {
      callCount++;
      if (callCount <= 2) {
        return new Response('Internal Server Error', { status: 500 });
      }
      return new Response(JSON.stringify({ import_id: 'retry-5xx-id' }), { status: 200 });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, _ms) => originalSetTimeout(fn, 0);
    try {
      const result = await submitPriceImport('https://worten.mirakl.net', 'test-key', 'csv-body');
      assert.deepStrictEqual(result, { importId: 'retry-5xx-id' });
      assert.strictEqual(callCount, 3, 'fetch should have been called 3 times (2 fails + 1 success)');
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  it('submit_price_import_retries_on_transport_error', async () => {
    // AC#2 retry behavior: transport-level fetch failures (DNS, ECONNRESET,
    // socket hang-up) are treated as status 0 and retried with exponential backoff.
    // Without this test the transport-error branch in submitPriceImport (the
    // try/catch around fetch) is uncovered.
    let callCount = 0;
    const mockFetch = mock.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('ECONNRESET');
      }
      return new Response(JSON.stringify({ import_id: 'transport-retry-id' }), { status: 200 });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, _ms) => originalSetTimeout(fn, 0);
    try {
      const result = await submitPriceImport('https://worten.mirakl.net', 'test-key', 'csv-body');
      assert.deepStrictEqual(result, { importId: 'transport-retry-id' });
      assert.strictEqual(callCount, 2, 'fetch should retry once after transport error');
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  it('submit_price_import_does_not_retry_on_4xx', async () => {
    let callCount = 0;
    const mockFetch = mock.fn(async () => {
      callCount++;
      return new Response('Bad Request', { status: 400 });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    try {
      await assert.rejects(
        () => submitPriceImport('https://worten.mirakl.net', 'test-key', 'csv-body'),
        (err) => err.name === 'MiraklApiError',
      );
      assert.strictEqual(callCount, 1, 'fetch should have been called exactly once (no retry on 4xx)');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// AC#3 — markStagingPending
// ---------------------------------------------------------------------------

describe('markStagingPending', () => {
  // Helper: build a mock tx that records all .query() calls
  // and supports controlled response values per query order
  function makeMockTx(responses = []) {
    let callIndex = 0;
    const calls = [];
    return {
      calls,
      query: async (sql, params) => {
        calls.push({ sql, params });
        const response = responses[callIndex++];
        return response ?? { rows: [] };
      },
    };
  }

  it('mark_staging_pending_sets_pending_import_id_on_all_channel_rows', async () => {
    const cycleId = randomUUID();
    const importId = randomUUID();
    const customerMarketplaceId = randomUUID();
    const skuId = randomUUID();
    const channelId1 = randomUUID();
    const channelId2 = randomUUID();

    const tx = makeMockTx([
      // Query 1: staging rows (PT channel staged, ES not staged = passthrough)
      { rows: [{ sku_id: skuId, channel_code: 'WRT_PT_ONLINE', new_price_cents: 1799 }] },
      // Query 2: sku_channels (2 rows: 1 staged PT + 1 passthrough ES)
      { rows: [
        { id: channelId1, sku_id: skuId, channel_code: 'WRT_PT_ONLINE', last_set_price_cents: 2000 },
        { id: channelId2, sku_id: skuId, channel_code: 'WRT_ES_ONLINE', last_set_price_cents: 2000 },
      ] },
      // Query 3: UPDATE channelId1
      { rows: [] },
      // Query 4: UPDATE channelId2
      { rows: [] },
      // Query 5: UPDATE pri01_staging
      { rows: [] },
    ]);

    await markStagingPending({ tx, cycleId, importId, customerMarketplaceId });

    // All UPDATE sku_channels calls should include importId
    const updateCalls = tx.calls.filter(c => c.sql.includes('UPDATE sku_channels'));
    assert.ok(updateCalls.length >= 2, `Expected at least 2 UPDATE sku_channels calls, got ${updateCalls.length}`);
    for (const call of updateCalls) {
      assert.ok(call.params.includes(importId), 'UPDATE sku_channels must include importId param');
    }
  });

  it('mark_staging_pending_sets_pending_set_price_cents_on_changing_rows', async () => {
    const cycleId = randomUUID();
    const importId = randomUUID();
    const customerMarketplaceId = randomUUID();
    const skuId = randomUUID();
    const channelId = randomUUID();

    const tx = makeMockTx([
      // staging row with channel_code
      { rows: [{ sku_id: skuId, channel_code: 'WRT_PT_ONLINE', new_price_cents: 1799 }] },
      { rows: [{ id: channelId, sku_id: skuId, channel_code: 'WRT_PT_ONLINE', last_set_price_cents: 2000 }] },
      { rows: [] },
      { rows: [] },
    ]);

    await markStagingPending({ tx, cycleId, importId, customerMarketplaceId });

    const updateChannelCall = tx.calls.find(c => c.sql.includes('UPDATE sku_channels') && c.params.includes(channelId));
    assert.ok(updateChannelCall, 'Should have an UPDATE sku_channels call for the channel');
    // pending_set_price_cents should be new_price_cents = 1799 for staged row
    assert.ok(updateChannelCall.params.includes(1799), `pending_set_price_cents should be 1799 (staged new price), params: ${JSON.stringify(updateChannelCall.params)}`);
  });

  it('mark_staging_pending_sets_last_set_price_for_passthrough_rows', async () => {
    const cycleId = randomUUID();
    const importId = randomUUID();
    const customerMarketplaceId = randomUUID();
    const skuId = randomUUID();
    const channelId1 = randomUUID();
    const channelId2 = randomUUID();

    // Only PT is staged (has a staging row); ES has no staging row = passthrough
    const tx = makeMockTx([
      // Staging: only PT channel staged
      { rows: [{ sku_id: skuId, channel_code: 'WRT_PT_ONLINE', new_price_cents: 1799 }] },
      // sku_channels: both PT and ES channels
      { rows: [
        { id: channelId1, sku_id: skuId, channel_code: 'WRT_PT_ONLINE', last_set_price_cents: 2000 },
        { id: channelId2, sku_id: skuId, channel_code: 'WRT_ES_ONLINE', last_set_price_cents: 2099 },
      ] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);

    await markStagingPending({ tx, cycleId, importId, customerMarketplaceId });

    // ES (channelId2) is a passthrough — its pending_set_price_cents should be last_set_price_cents = 2099
    const updateEs = tx.calls.find(c => c.sql.includes('UPDATE sku_channels') && c.params.includes(channelId2));
    assert.ok(updateEs, 'Should have UPDATE for ES channel');
    assert.ok(updateEs.params.includes(2099), `Passthrough channel should use last_set_price_cents=2099, params: ${JSON.stringify(updateEs.params)}`);
  });

  it('mark_staging_pending_marks_flushed_at_on_staging_rows', async () => {
    const cycleId = randomUUID();
    const importId = randomUUID();
    const customerMarketplaceId = randomUUID();
    const skuId = randomUUID();

    const tx = makeMockTx([
      { rows: [{ sku_id: skuId, channel_code: 'WRT_PT_ONLINE', new_price_cents: 1799 }] },
      { rows: [{ id: randomUUID(), sku_id: skuId, channel_code: 'WRT_PT_ONLINE', last_set_price_cents: 2000 }] },
      { rows: [] },
      { rows: [] },
    ]);

    await markStagingPending({ tx, cycleId, importId, customerMarketplaceId });

    const stagingUpdate = tx.calls.find(c => c.sql.includes('UPDATE pri01_staging'));
    assert.ok(stagingUpdate, 'Should have UPDATE pri01_staging call');
    assert.ok(stagingUpdate.sql.includes('flushed_at'), 'SQL must include flushed_at = NOW()');
  });

  it('mark_staging_pending_sets_import_id_on_staging_rows', async () => {
    const cycleId = randomUUID();
    const importId = randomUUID();
    const customerMarketplaceId = randomUUID();
    const skuId = randomUUID();

    const tx = makeMockTx([
      { rows: [{ sku_id: skuId, channel_code: 'WRT_PT_ONLINE', new_price_cents: 1799 }] },
      { rows: [{ id: randomUUID(), sku_id: skuId, channel_code: 'WRT_PT_ONLINE', last_set_price_cents: 2000 }] },
      { rows: [] },
      { rows: [] },
    ]);

    await markStagingPending({ tx, cycleId, importId, customerMarketplaceId });

    const stagingUpdate = tx.calls.find(c => c.sql.includes('UPDATE pri01_staging'));
    assert.ok(stagingUpdate, 'Should have UPDATE pri01_staging call');
    assert.ok(stagingUpdate.params.includes(importId), 'pri01_staging UPDATE must include importId');
    assert.ok(stagingUpdate.sql.includes('import_id'), 'SQL must include import_id field');
  });

  it('mark_staging_pending_operates_in_single_transaction', async () => {
    const cycleId = randomUUID();
    const importId = randomUUID();
    const customerMarketplaceId = randomUUID();
    const skuId = randomUUID();

    const tx = makeMockTx([
      { rows: [{ sku_id: skuId, channel_code: 'WRT_PT_ONLINE', new_price_cents: 1799 }] },
      { rows: [{ id: randomUUID(), sku_id: skuId, channel_code: 'WRT_PT_ONLINE', last_set_price_cents: 2000 }] },
      { rows: [] },
      { rows: [] },
    ]);

    // Track which tx objects were used — all queries must be on the same tx
    const querySpy = tx.query;
    let queryCalls = 0;
    tx.query = async (sql, params) => {
      queryCalls++;
      return querySpy(sql, params);
    };

    await markStagingPending({ tx, cycleId, importId, customerMarketplaceId });

    // All calls were routed through the single tx.query — proving single-tx semantics
    assert.ok(queryCalls >= 3, `Expected at least 3 queries in single tx, got ${queryCalls}`);
    // All entries in tx.calls should be there (no separate client used)
    assert.ok(tx.calls.length >= 3, 'All queries must be recorded in the single transaction');
  });

  it('mark_staging_pending_no_cycle_row_left_without_pending_import_id', async () => {
    const cycleId = randomUUID();
    const importId = randomUUID();
    const customerMarketplaceId = randomUUID();
    const skuId1 = randomUUID();
    const skuId2 = randomUUID();
    const channelIds = [randomUUID(), randomUUID(), randomUUID()];

    const tx = makeMockTx([
      // Staging: 2 staged rows (sku1/PT, sku2/PT); sku2/ES is passthrough (no staging row)
      { rows: [
        { sku_id: skuId1, channel_code: 'WRT_PT_ONLINE', new_price_cents: 1799 },
        { sku_id: skuId2, channel_code: 'WRT_PT_ONLINE', new_price_cents: 1999 },
      ] },
      // sku_channels: 3 channels total (1 for sku1, 2 for sku2)
      { rows: [
        { id: channelIds[0], sku_id: skuId1, channel_code: 'WRT_PT_ONLINE', last_set_price_cents: 2000 },
        { id: channelIds[1], sku_id: skuId2, channel_code: 'WRT_PT_ONLINE', last_set_price_cents: 2100 },
        { id: channelIds[2], sku_id: skuId2, channel_code: 'WRT_ES_ONLINE', last_set_price_cents: 2200 },
      ] },
      // 3x UPDATE sku_channels + 1x UPDATE pri01_staging
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);

    await markStagingPending({ tx, cycleId, importId, customerMarketplaceId });

    // After call: verify ALL channel IDs appear in UPDATE calls with importId
    const updatedChannelIds = new Set();
    for (const call of tx.calls) {
      if (call.sql.includes('UPDATE sku_channels') && call.params.includes(importId)) {
        // The id param should be in the params list
        for (const p of call.params) {
          if (channelIds.includes(p)) {
            updatedChannelIds.add(p);
          }
        }
      }
    }
    // All 3 channels must have been updated (zero rows left without pending_import_id)
    assert.strictEqual(updatedChannelIds.size, 3, `Expected 3 channels updated, got ${updatedChannelIds.size}. Bundle C invariant: zero rows with pending_import_id IS NULL.`);
  });
});

// ---------------------------------------------------------------------------
// AC#4 — ESLint no-raw-CSV-building rule
// ---------------------------------------------------------------------------
// Pattern: write fixture files into worker/src/ (covered by eslint.config.js 'local-cron' scope),
// run ESLint with cwd: repoRoot, then clean up.
// Follows the same approach as Story 5.1's worker-must-filter-by-customer ESLint tests.

describe('ESLint no-raw-CSV-building rule', () => {
  it('eslint_no_raw_csv_building_fires_on_csv_stringify_usage', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const fixturePath = join(repoRoot, 'worker', 'src', `__eslint_fixture_csv_stringify_${randomUUID().slice(0, 8)}__.js`);

    const fixtureContent = `// ESLint test fixture — DO NOT SHIP
import { stringify } from 'csv-stringify/sync';
stringify([]);
`;

    const cleanup = async () => { try { await unlink(fixturePath); } catch { /* ok */ } };
    try {
      await writeFile(fixturePath, fixtureContent, 'utf8');
      const eslint = new ESLint({ cwd: repoRoot });
      const results = await eslint.lintFiles([fixturePath]);
      const messages = results.flatMap(r => r.messages);
      const csvViolation = messages.find(m => m.ruleId === 'local-cron/no-raw-CSV-building');
      assert.ok(csvViolation, `Expected no-raw-CSV-building violation for csv-stringify import. Messages: ${JSON.stringify(messages.map(m => m.ruleId))}`);
    } finally {
      await cleanup();
    }
  });

  it('eslint_no_raw_csv_building_fires_on_manual_csv_concatenation', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const fixturePath = join(repoRoot, 'worker', 'src', `__eslint_fixture_csv_manual_${randomUUID().slice(0, 8)}__.js`);

    // Template literal with semicolon+newline CSV-building pattern (no actual newline, escaped \n)
    const fixtureContent = '// ESLint test fixture — DO NOT SHIP\n' +
      'function buildRow(sku, price) { return `' + '${sku};${price}\\n' + '`; }\n';

    const cleanup = async () => { try { await unlink(fixturePath); } catch { /* ok */ } };
    try {
      await writeFile(fixturePath, fixtureContent, 'utf8');
      const eslint = new ESLint({ cwd: repoRoot });
      const results = await eslint.lintFiles([fixturePath]);
      const messages = results.flatMap(r => r.messages);
      const csvViolation = messages.find(m => m.ruleId === 'local-cron/no-raw-CSV-building');
      assert.ok(csvViolation, `Expected no-raw-CSV-building violation for template literal CSV. Messages: ${JSON.stringify(messages.map(m => m.ruleId))}`);
    } finally {
      await cleanup();
    }
  });

  it('eslint_no_raw_csv_building_does_not_fire_in_pri01_writer_js', async () => {
    const pri01WriterPath = join(repoRoot, 'shared/mirakl/pri01-writer.js');
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintFiles([pri01WriterPath]);
    const messages = results.flatMap(r => r.messages);
    const csvViolations = messages.filter(m => m.ruleId === 'local-cron/no-raw-CSV-building');
    assert.strictEqual(csvViolations.length, 0, `no-raw-CSV-building should NOT fire in pri01-writer.js (allowlisted). Violations: ${JSON.stringify(csvViolations)}`);
  });

  it('eslint_no_raw_csv_building_does_not_fire_on_csv_reading', async () => {
    const { writeFile, unlink } = await import('node:fs/promises');
    const fixturePath = join(repoRoot, 'worker', 'src', `__eslint_fixture_csv_reader_${randomUUID().slice(0, 8)}__.js`);

    // Reading a CSV file — not building one
    const fixtureContent = `// ESLint test fixture — DO NOT SHIP
import { readFileSync } from 'node:fs';
const data = readFileSync('tests/fixtures/pri01-csv/single-channel-undercut.csv', 'utf-8');
`;

    const cleanup = async () => { try { await unlink(fixturePath); } catch { /* ok */ } };
    try {
      await writeFile(fixturePath, fixtureContent, 'utf8');
      const eslint = new ESLint({ cwd: repoRoot });
      const results = await eslint.lintFiles([fixturePath]);
      const messages = results.flatMap(r => r.messages);
      const csvViolations = messages.filter(m => m.ruleId === 'local-cron/no-raw-CSV-building');
      assert.strictEqual(csvViolations.length, 0, `no-raw-CSV-building should NOT fire on CSV reading. Violations: ${JSON.stringify(csvViolations)}`);
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// AC#6 — csv_line_number persisted at flush (course correction 2026-05-09)
// ---------------------------------------------------------------------------

describe('csv_line_number persistence (AC#6)', () => {
  // Helper: build a mock tx that records all .query() calls
  function makeMockTxWithLineNum(responses = []) {
    let callIndex = 0;
    const calls = [];
    return {
      calls,
      query: async (sql, params) => {
        calls.push({ sql, params });
        const response = responses[callIndex++];
        return response ?? { rows: [] };
      },
    };
  }

  it('csv_line_number_persisted_after_flush', async () => {
    // Arrange: a 2-line CSV — line 1 = WRT_PT_ONLINE, line 2 = WRT_ES_ONLINE (same SKU)
    const cycleId = randomUUID();
    const importId = randomUUID();
    const customerMarketplaceId = randomUUID();
    const skuId = randomUUID();
    const channelId1 = randomUUID();
    const channelId2 = randomUUID();
    const stagingId1 = randomUUID();
    const stagingId2 = randomUUID();
    const shopSku = 'EZ8809606851663';

    // lineMap from buildPri01Csv: line 1 = WRT_PT_ONLINE, line 2 = WRT_ES_ONLINE
    const lineMap = { 1: shopSku, 2: shopSku };

    const tx = makeMockTxWithLineNum([
      // Query 1: pri01_staging SELECT (now includes id + shop_sku via JOIN skus)
      {
        rows: [
          { id: stagingId1, sku_id: skuId, channel_code: 'WRT_PT_ONLINE', new_price_cents: 1799, shop_sku: shopSku },
          { id: stagingId2, sku_id: skuId, channel_code: 'WRT_ES_ONLINE', new_price_cents: 1850, shop_sku: shopSku },
        ]
      },
      // Query 2: sku_channels SELECT
      {
        rows: [
          { id: channelId1, sku_id: skuId, channel_code: 'WRT_PT_ONLINE', last_set_price_cents: 1799 },
          { id: channelId2, sku_id: skuId, channel_code: 'WRT_ES_ONLINE', last_set_price_cents: 1850 },
        ]
      },
      // Query 3: UPDATE sku_channels channelId1
      { rows: [] },
      // Query 4: UPDATE sku_channels channelId2
      { rows: [] },
      // Query 5: UPDATE pri01_staging (bulk flushed_at + import_id)
      { rows: [] },
      // Query 6: UPDATE pri01_staging SET csv_line_number = 1 WHERE id = stagingId1
      { rows: [] },
      // Query 7: UPDATE pri01_staging SET csv_line_number = 2 WHERE id = stagingId2
      { rows: [] },
    ]);

    await markStagingPending({ tx, cycleId, importId, customerMarketplaceId, lineMap });

    // Assert csv_line_number UPDATE calls were issued
    const csvLineNumberUpdates = tx.calls.filter(c => {
      const sql = c.sql.toLowerCase();
      return sql.includes('update pri01_staging') && sql.includes('csv_line_number');
    });

    assert.equal(
      csvLineNumberUpdates.length,
      2,
      `Expected exactly 2 csv_line_number UPDATE queries (one per lineMap entry), got ${csvLineNumberUpdates.length}. ` +
      `Calls: ${JSON.stringify(tx.calls.map(c => c.sql.slice(0, 60)))}`
    );

    // Assert the csv_line_number values match the lineMap integer keys
    const lineNumbers = csvLineNumberUpdates.map(c => c.params[0]).sort((a, b) => a - b);
    assert.deepEqual(lineNumbers, [1, 2],
      'csv_line_number UPDATE must persist the integer lineMap keys (1 and 2)');

    // Assert the staging IDs are targeted correctly (per-row targeting — not bulk)
    const targetedIds = csvLineNumberUpdates.map(c => c.params[1]);
    assert.ok(
      targetedIds.includes(stagingId1) || targetedIds.includes(stagingId2),
      'csv_line_number updates must target specific staging row IDs (not bulk cycle_id predicate)'
    );

    // Assert these are in the same tx as the import_id update (single transaction invariant)
    const importIdUpdate = tx.calls.find(c =>
      c.sql.toLowerCase().includes('update pri01_staging') &&
      c.sql.toLowerCase().includes('import_id') &&
      !c.sql.toLowerCase().includes('csv_line_number')
    );
    assert.ok(importIdUpdate, 'import_id UPDATE must also be in the same tx');
  });
});

// ---------------------------------------------------------------------------
// AC#5 — PC01 capture completeness
// ---------------------------------------------------------------------------

describe('PC01 capture completeness guard', () => {
  it('build_pri01_csv_throws_on_null_operator_csv_delimiter_with_customer_id_in_message', () => {
    const customerMarketplaceId = 'cm-uuid-123';
    assert.throws(
      () => buildPri01Csv({
        skuChannels: [{ shopSku: 'EZ123', channelCode: 'WRT_PT_ONLINE', newPriceCents: 1799, lastSetPriceCents: 2000 }],
        operatorCsvDelimiter: null,
        offerPricesDecimals: 2,
        customerMarketplaceId,
      }),
      (err) => {
        assert.ok(err.message.includes('cm-uuid-123'), `Error message must contain customer ID. Got: ${err.message}`);
        assert.ok(err.message.includes('operator_csv_delimiter'), `Error message must mention operator_csv_delimiter. Got: ${err.message}`);
        assert.ok(
          err.message.includes('PC01 monthly re-pull') || err.message.includes('onboarding scan'),
          `Error message must mention re-run steps. Got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('build_pri01_csv_throws_on_null_offer_prices_decimals_with_customer_id_in_message', () => {
    const customerMarketplaceId = 'cm-uuid-456';
    assert.throws(
      () => buildPri01Csv({
        skuChannels: [{ shopSku: 'EZ123', channelCode: 'WRT_PT_ONLINE', newPriceCents: 1799, lastSetPriceCents: 2000 }],
        operatorCsvDelimiter: 'SEMICOLON',
        offerPricesDecimals: null,
        customerMarketplaceId,
      }),
      (err) => {
        assert.ok(err.message.includes('cm-uuid-456'), `Error message must contain customer ID. Got: ${err.message}`);
        assert.ok(err.message.includes('offer_prices_decimals'), `Error message must mention offer_prices_decimals. Got: ${err.message}`);
        return true;
      },
    );
  });
});
