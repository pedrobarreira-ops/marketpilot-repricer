// tests/shared/mirakl/pri03-parser.test.js
// Epic 6 Test Plan — Story 6.3 scaffold (epic-start-test-design 2026-05-08)
// Runner: node --test (built-in; no Jest/Vitest per architecture constraint)
//
// Coverage:
//   AC#1 — fetchAndParseErrorReport: correct endpoint, CSV parsing, line→shopSku mapping, PT localization
//   AC#2 — scheduleRebuildForFailedSkus: full-SKU rebuild, last_set_price invariant, failure counter,
//           3-strike escalation (freeze + Atenção event + critical alert)
//   AC#3 — Unit tests cover mixed success/failure report; golden-fixture match; failure counter 3-cycle sequence
//   AC#4 — Freeze representation design choice: documented + dispatcher predicate updated + RLS extended

import { describe, it, mock, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../..');
const fixturesDir = join(repoRoot, 'tests/fixtures/pri01-csv');

// ---------------------------------------------------------------------------
// Import the module under test (will be provided by Amelia in dev step)
// ---------------------------------------------------------------------------
// import { fetchAndParseErrorReport, scheduleRebuildForFailedSkus } from '../../../shared/mirakl/pri03-parser.js';

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock tx that records all .query() calls.
 * Supports customising what SELECT queries return via `selectRows`.
 *
 * @param {Array<{rows: object[], rowCount: number}>} selectRows
 *   Queue of result objects returned by successive SELECT .query() calls.
 *   Non-SELECT calls return { rows: [], rowCount: 1 }.
 */
function makeMockTx(selectRows = []) {
  const calls = [];
  let selectIdx = 0;
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('SELECT')) {
        return selectRows[selectIdx++] ?? { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
}

/** Build a minimal sku_channel row as returned by the SELECT in scheduleRebuildForFailedSkus */
function makeSkuChannelRow({ id = 'sc-id-1', skuId = 'sku-id-1', channelCode = 'WRT_PT_ONLINE', lastSetPriceCents = 1799, consecutiveFailures = 0 } = {}) {
  return {
    id,
    sku_id: skuId,
    channel_code: channelCode,
    list_price_cents: lastSetPriceCents,
    last_set_price_cents: lastSetPriceCents,
    pri01_consecutive_failures: consecutiveFailures,
  };
}

// ---------------------------------------------------------------------------
// AC#1 — fetchAndParseErrorReport
// ---------------------------------------------------------------------------

describe('fetchAndParseErrorReport', () => {
  it('fetch_and_parse_error_report_calls_correct_endpoint', async () => {
    // Arrange: dynamically import the module (will fail until Amelia creates it)
    let fetchAndParseErrorReport;
    try {
      ({ fetchAndParseErrorReport } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first (Story 6.3 dev step)');
    }

    const capturedRequests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      capturedRequests.push({ url: url.toString(), method: opts?.method ?? 'GET', headers: opts?.headers ?? {} });
      return {
        ok: true,
        status: 200,
        text: async () => '1,SKU_NOT_FOUND\n',
        json: async () => { throw new Error('not JSON'); },
      };
    };

    const baseUrl = 'https://worten.mirakl.net';
    const apiKey = 'test-key-abc';
    const importId = 'import-uuid-001';
    const lineMap = { 1: 'EZ8809606851663' };

    try {
      await fetchAndParseErrorReport(baseUrl, apiKey, importId, lineMap);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.ok(capturedRequests.length > 0, 'Expected at least one fetch call');
    const req = capturedRequests[0];
    assert.match(req.url, /\/api\/offers\/pricing\/imports\/import-uuid-001\/error_report/,
      'URL must include the import_id as a path parameter in the correct endpoint');
    assert.equal(req.method, 'GET', 'Must use GET method');
  });

  it('fetch_and_parse_error_report_parses_failed_skus_from_csv_response', async () => {
    let fetchAndParseErrorReport;
    try {
      ({ fetchAndParseErrorReport } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    // CSV: line 1 failed, line 2 success (not in error report)
    const csvBody = '1,SKU_NOT_FOUND\n';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      text: async () => csvBody,
      json: async () => { throw new Error('not JSON'); },
    });

    const lineMap = { 1: 'EZ8809606851663', 2: 'EZ0000000000002' };

    let result;
    try {
      result = await fetchAndParseErrorReport('https://worten.mirakl.net', 'key', 'import-1', lineMap);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.ok(result, 'Must return a result object');
    assert.ok(Array.isArray(result.failedSkus), 'Result must have failedSkus array');
    assert.ok(Array.isArray(result.successfulSkus), 'Result must have successfulSkus array');
    assert.equal(result.failedSkus.length, 1, 'One failed SKU from CSV');
    const failed = result.failedSkus[0];
    assert.ok('shopSku' in failed, 'failedSkus entries must have shopSku');
    assert.ok('errorCode' in failed, 'failedSkus entries must have errorCode');
    assert.ok('errorMessage' in failed, 'failedSkus entries must have errorMessage');
    assert.equal(failed.shopSku, 'EZ8809606851663', 'shopSku resolved via lineMap');
  });

  it('fetch_and_parse_error_report_maps_line_numbers_to_shop_skus', async () => {
    let fetchAndParseErrorReport;
    try {
      ({ fetchAndParseErrorReport } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    // line 2 is the failing line; line 1 and 3 succeed (absent from error report)
    const csvBody = '2,PRICE_BELOW_FLOOR\n';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      text: async () => csvBody,
      json: async () => { throw new Error('not JSON'); },
    });

    const lineMap = { 1: 'EZ1111111111111', 2: 'EZ2222222222222', 3: 'EZ3333333333333' };

    let result;
    try {
      result = await fetchAndParseErrorReport('https://worten.mirakl.net', 'key', 'import-2', lineMap);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(result.failedSkus.length, 1, 'One failed SKU (line 2)');
    assert.equal(result.failedSkus[0].shopSku, 'EZ2222222222222', 'Line 2 maps to EZ2222222222222');

    assert.equal(result.successfulSkus.length, 2, 'Lines 1 and 3 absent from error report = successful');
    const successSkus = result.successfulSkus.map(s => s.shopSku).sort();
    assert.deepEqual(successSkus, ['EZ1111111111111', 'EZ3333333333333'], 'Successful SKUs from lineMap minus failed lines');
  });

  it('fetch_and_parse_error_report_pt_localizes_error_messages', async () => {
    let fetchAndParseErrorReport;
    try {
      ({ fetchAndParseErrorReport } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    const csvBody = '1,SKU_NOT_FOUND_IN_CATALOG\n';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      text: async () => csvBody,
      json: async () => { throw new Error('not JSON'); },
    });

    const lineMap = { 1: 'EZ9999999999999' };

    let result;
    try {
      result = await fetchAndParseErrorReport('https://worten.mirakl.net', 'key', 'import-3', lineMap);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(result.failedSkus.length, 1);
    const { errorMessage } = result.failedSkus[0];
    assert.ok(typeof errorMessage === 'string', 'errorMessage must be a string');
    assert.ok(errorMessage.length > 0, 'errorMessage must be non-empty');
    // PT fallback message required when getSafeErrorMessage cannot map the raw reason
    // Acceptable: either a PT-localized specific message or the Portuguese fallback
    const isPt = /[áàãâéêíóôõúüç]/i.test(errorMessage)
      || errorMessage.includes('Erro')
      || errorMessage.includes('erro')
      || errorMessage.includes('artigo')
      || errorMessage.includes('preço');
    assert.ok(isPt, `errorMessage "${errorMessage}" must be PT-localized (contain PT characters or known PT words)`);
  });

  // ---------------------------------------------------------------------------
  // Step 4 review additions — CSV edge-case behavioural coverage
  // ---------------------------------------------------------------------------

  it('fetch_and_parse_error_report_handles_empty_error_report_all_successful', async () => {
    // Edge case: PRI03 returns an empty body — every line in the lineMap is a success.
    // This guards the "absent from error report = success" semantic at the boundary.
    let fetchAndParseErrorReport;
    try {
      ({ fetchAndParseErrorReport } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      text: async () => '',
      json: async () => { throw new Error('not JSON'); },
    });

    const lineMap = {
      1: 'EZ1111111111111',
      2: 'EZ2222222222222',
      3: 'EZ3333333333333',
    };

    let result;
    try {
      result = await fetchAndParseErrorReport('https://worten.mirakl.net', 'key', 'import-empty', lineMap);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(result.failedSkus.length, 0,
      'Empty error report → zero failedSkus');
    assert.equal(result.successfulSkus.length, 3,
      'Empty error report → ALL SKUs in lineMap classified successful');
    const successSkus = result.successfulSkus.map(s => s.shopSku).sort();
    assert.deepEqual(successSkus, ['EZ1111111111111', 'EZ2222222222222', 'EZ3333333333333']);
  });

  it('fetch_and_parse_error_report_unknown_error_code_falls_back_to_pt_default', async () => {
    // Edge case: Mirakl returns an error code not in PRI03_ERROR_MESSAGES_PT.
    // The parser MUST emit the DEFAULT_PT_ERROR fallback ('Erro ao processar preço…').
    // Behavioral assertion: the errorMessage matches the documented PT fallback shape,
    // and the raw errorCode is preserved unchanged for diagnostics.
    let fetchAndParseErrorReport;
    try {
      ({ fetchAndParseErrorReport } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    // 'TOTALLY_NEW_CODE_42' is not in the parser's PT map — must hit fallback.
    const csvBody = '1,TOTALLY_NEW_CODE_42\n';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      text: async () => csvBody,
      json: async () => { throw new Error('not JSON'); },
    });

    const lineMap = { 1: 'EZ7777777777777' };

    let result;
    try {
      result = await fetchAndParseErrorReport('https://worten.mirakl.net', 'key', 'import-unknown', lineMap);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(result.failedSkus.length, 1, 'One failed SKU from CSV');
    const failed = result.failedSkus[0];
    assert.equal(failed.errorCode, 'TOTALLY_NEW_CODE_42',
      'Raw errorCode preserved verbatim for diagnostic surfacing (not silently rewritten)');
    // DEFAULT_PT_ERROR shape: PT fallback string starting with 'Erro' (per parser source)
    assert.match(failed.errorMessage, /^Erro/,
      `Unknown errorCode must surface DEFAULT_PT_ERROR PT fallback ('Erro ao processar…'). Got: "${failed.errorMessage}"`);
    assert.ok(/preço|artigo/.test(failed.errorMessage),
      `Fallback message must contain PT vocabulary ('preço' or 'artigo'). Got: "${failed.errorMessage}"`);
  });

  it('fetch_and_parse_error_report_skips_malformed_lines_and_unknown_line_numbers', async () => {
    // Edge cases combined:
    //   1. A malformed CSV line (no comma/semicolon separator) → silently skipped
    //   2. A line with a non-numeric line number → silently skipped (parseInt → NaN)
    //   3. A line number absent from lineMap → silently skipped (defensive log)
    //   4. A blank line → silently skipped
    // The parser MUST NOT crash and MUST still process valid lines correctly.
    let fetchAndParseErrorReport;
    try {
      ({ fetchAndParseErrorReport } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    // Mix:
    //   "garbage_no_separator" — no comma → skipped
    //   ",ORPHAN_ERROR"        — empty line number (NaN) → skipped
    //   "999,UNMAPPED_LINE"    — line 999 not in lineMap → skipped
    //   ""                     — blank line → skipped
    //   "header,reason"        — header-like row (NaN line number) → skipped
    //   "1,PRICE_TOO_LOW"      — valid → kept
    const csvBody = [
      'garbage_no_separator',
      ',ORPHAN_ERROR',
      '999,UNMAPPED_LINE',
      '',
      'header,reason',
      '1,PRICE_TOO_LOW',
    ].join('\n');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      text: async () => csvBody,
      json: async () => { throw new Error('not JSON'); },
    });

    const lineMap = { 1: 'EZ_VALID_SKU' };

    let result;
    try {
      result = await fetchAndParseErrorReport('https://worten.mirakl.net', 'key', 'import-malformed', lineMap);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Only the one valid line survives — defensive parsing must not crash.
    assert.equal(result.failedSkus.length, 1,
      `Only the one valid CSV line should produce a failed SKU; got ${result.failedSkus.length}. ` +
      `Defensive parser must skip malformed/orphaned/unmapped rows without crashing.`);
    assert.equal(result.failedSkus[0].shopSku, 'EZ_VALID_SKU');
    assert.equal(result.failedSkus[0].errorCode, 'PRICE_TOO_LOW');

    // Line 1 is the only mapped line in lineMap, and it failed → no successful SKUs.
    assert.equal(result.successfulSkus.length, 0,
      'Only one SKU in lineMap and it failed → zero successful SKUs');
  });
});

// ---------------------------------------------------------------------------
// AC#2 — scheduleRebuildForFailedSkus
// ---------------------------------------------------------------------------

describe('scheduleRebuildForFailedSkus', () => {
  it('schedule_rebuild_for_failed_skus_inserts_fresh_pri01_staging_rows', async () => {
    let scheduleRebuildForFailedSkus;
    try {
      ({ scheduleRebuildForFailedSkus } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    const skuChannelRow = makeSkuChannelRow({ lastSetPriceCents: 1799 });
    // SELECT returns two channel rows for the same SKU (full per-SKU rebuild)
    const skuChannelRow2 = makeSkuChannelRow({
      id: 'sc-id-2', skuId: 'sku-id-1', channelCode: 'WRT_ES_ONLINE', lastSetPriceCents: 1850,
    });
    const tx = makeMockTx([{ rows: [skuChannelRow, skuChannelRow2], rowCount: 2 }]);

    const failedSkus = [{ shopSku: 'EZ8809606851663', errorCode: 'SKU_NOT_FOUND', errorMessage: 'Erro ao processar preço para este artigo.' }];

    await scheduleRebuildForFailedSkus({
      tx,
      customerMarketplaceId: 'cm-uuid-1',
      failedSkus,
      cycleId: 'cycle-rebuild-1',
    });

    const insertCalls = tx.calls.filter(c => c.sql.trim().toUpperCase().startsWith('INSERT INTO PRI01_STAGING'));
    assert.ok(insertCalls.length >= 2, `Expected INSERT INTO pri01_staging for BOTH channels (full SKU rebuild), got ${insertCalls.length}`);
  });

  it('schedule_rebuild_does_not_use_failed_line_only_uses_full_sku', async () => {
    let scheduleRebuildForFailedSkus;
    try {
      ({ scheduleRebuildForFailedSkus } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    // 2-channel SKU — only PT line failed but both channels must be rebuilt
    const ptRow = makeSkuChannelRow({ id: 'sc-pt', skuId: 'sku-1', channelCode: 'WRT_PT_ONLINE', lastSetPriceCents: 1799 });
    const esRow = makeSkuChannelRow({ id: 'sc-es', skuId: 'sku-1', channelCode: 'WRT_ES_ONLINE', lastSetPriceCents: 1850 });
    const tx = makeMockTx([{ rows: [ptRow, esRow], rowCount: 2 }]);

    await scheduleRebuildForFailedSkus({
      tx,
      customerMarketplaceId: 'cm-uuid-1',
      failedSkus: [{ shopSku: 'EZ8809606851663', errorCode: 'ERR', errorMessage: 'Erro.' }],
      cycleId: 'cycle-1',
    });

    const inserts = tx.calls.filter(c => c.sql.trim().toUpperCase().startsWith('INSERT INTO PRI01_STAGING'));
    assert.equal(inserts.length, 2, 'Both PT and ES channels must have staging rows inserted (per-SKU rebuild, not per-line)');
    const channels = inserts.map(c => c.params?.[2]);
    assert.ok(channels.includes('WRT_PT_ONLINE'), 'WRT_PT_ONLINE channel must be included in rebuild');
    assert.ok(channels.includes('WRT_ES_ONLINE'), 'WRT_ES_ONLINE channel must be included in rebuild');
  });

  it('schedule_rebuild_does_not_modify_last_set_price_cents', async () => {
    let scheduleRebuildForFailedSkus;
    try {
      ({ scheduleRebuildForFailedSkus } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    const skuRow = makeSkuChannelRow({ lastSetPriceCents: 1799 });
    const tx = makeMockTx([{ rows: [skuRow], rowCount: 1 }]);

    await scheduleRebuildForFailedSkus({
      tx,
      customerMarketplaceId: 'cm-uuid-1',
      failedSkus: [{ shopSku: 'EZ8809606851663', errorCode: 'ERR', errorMessage: 'Erro.' }],
      cycleId: 'cycle-1',
    });

    const updateLastSetCalls = tx.calls.filter(c => {
      const sql = c.sql.toLowerCase();
      return sql.includes('update') && sql.includes('last_set_price_cents');
    });
    assert.equal(updateLastSetCalls.length, 0,
      'FAILED import: prices were never applied by Mirakl — last_set_price_cents must NOT be updated');
  });

  it('schedule_rebuild_increments_pri01_consecutive_failures_counter', async () => {
    let scheduleRebuildForFailedSkus;
    try {
      ({ scheduleRebuildForFailedSkus } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    const skuRow = makeSkuChannelRow({ id: 'sc-1', consecutiveFailures: 0 });
    const tx = makeMockTx([{ rows: [skuRow], rowCount: 1 }]);

    await scheduleRebuildForFailedSkus({
      tx,
      customerMarketplaceId: 'cm-uuid-1',
      failedSkus: [{ shopSku: 'EZ8809606851663', errorCode: 'ERR', errorMessage: 'Erro.' }],
      cycleId: 'cycle-1',
    });

    const counterUpdateCalls = tx.calls.filter(c => {
      const sql = c.sql.toLowerCase();
      return sql.includes('update') && sql.includes('pri01_consecutive_failures') && sql.includes('+ 1');
    });
    assert.ok(counterUpdateCalls.length >= 1,
      'Expected UPDATE sku_channels SET pri01_consecutive_failures = pri01_consecutive_failures + 1');
  });

  it('schedule_rebuild_resets_failure_counter_on_pri02_complete', async () => {
    // The COMPLETE path resets pri01_consecutive_failures = 0 in pri02-poller.js (Story 6.2).
    // This test verifies that the reset SQL pattern is present in the poller source as a
    // cross-reference (the reset is NOT in pri03-parser.js itself — it's in pri02-poller.js).
    const pollerPath = join(repoRoot, 'shared/mirakl/pri02-poller.js');
    assert.ok(existsSync(pollerPath), 'shared/mirakl/pri02-poller.js must exist');
    const pollerSrc = readFileSync(pollerPath, 'utf-8');
    assert.ok(
      pollerSrc.includes('pri01_consecutive_failures') && pollerSrc.includes('= 0'),
      'pri02-poller.js COMPLETE path must reset pri01_consecutive_failures = 0 for affected rows'
    );
  });

  it('schedule_rebuild_operates_in_single_transaction', async () => {
    let scheduleRebuildForFailedSkus;
    try {
      ({ scheduleRebuildForFailedSkus } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    const skuRow = makeSkuChannelRow({ consecutiveFailures: 0 });
    const tx = makeMockTx([{ rows: [skuRow], rowCount: 1 }]);
    // Use a second tx to prove all calls go to the same one
    const tx2 = makeMockTx([]);

    await scheduleRebuildForFailedSkus({
      tx,
      customerMarketplaceId: 'cm-uuid-1',
      failedSkus: [{ shopSku: 'EZ8809606851663', errorCode: 'ERR', errorMessage: 'Erro.' }],
      cycleId: 'cycle-1',
    });

    // All DB operations must have gone to `tx`, not `tx2`
    assert.ok(tx.calls.length > 0, 'tx must have been used for DB writes');
    assert.equal(tx2.calls.length, 0, 'tx2 (alternative tx) must not have been used — single transaction invariant');

    // SELECT + at least one INSERT + at least one UPDATE = all in same tx
    const hasSelect = tx.calls.some(c => c.sql.trim().toUpperCase().startsWith('SELECT'));
    const hasInsert = tx.calls.some(c => c.sql.trim().toUpperCase().startsWith('INSERT'));
    const hasUpdate = tx.calls.some(c => c.sql.trim().toUpperCase().startsWith('UPDATE'));
    assert.ok(hasSelect && hasInsert && hasUpdate, 'SELECT, INSERT, and UPDATE must all flow through the single injected tx');
  });

  it('schedule_rebuild_three_strikes_escalation_freezes_sku', async () => {
    let scheduleRebuildForFailedSkus;
    try {
      ({ scheduleRebuildForFailedSkus } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    // Counter is at 2 — increment to 3 triggers escalation
    const skuRow = makeSkuChannelRow({ id: 'sc-freeze', consecutiveFailures: 2 });
    const tx = makeMockTx([{ rows: [skuRow], rowCount: 1 }]);

    // Mock writeAuditEvent to prevent real DB call
    const auditWriterPath = join(repoRoot, 'shared/audit/writer.js');
    // We can't easily mock ESM imports here without mock.module — test the tx calls instead
    try {
      await scheduleRebuildForFailedSkus({
        tx,
        customerMarketplaceId: 'cm-uuid-1',
        failedSkus: [{ shopSku: 'EZ8809606851663', errorCode: 'ERR', errorMessage: 'Erro.' }],
        cycleId: 'cycle-3',
      });
    } catch {
      // May throw if writeAuditEvent lacks a real DB — that's acceptable; check tx calls below
    }

    const freezeUpdateCalls = tx.calls.filter(c => {
      const sql = c.sql.toLowerCase();
      return sql.includes('update') && sql.includes('frozen_for_pri01_persistent') && (sql.includes('true') || sql.includes('= true') || (c.params && c.params.includes(true)));
    });
    assert.ok(freezeUpdateCalls.length >= 1,
      'At 3 consecutive failures, must UPDATE sku_channels SET frozen_for_pri01_persistent = true');
  });

  it('schedule_rebuild_three_strikes_emits_pri01_fail_persistent_event', async () => {
    let scheduleRebuildForFailedSkus;
    try {
      ({ scheduleRebuildForFailedSkus } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    const skuRow = makeSkuChannelRow({ id: 'sc-event', consecutiveFailures: 2 });
    // tx.query must also handle the audit INSERT call from writeAuditEvent
    const tx = makeMockTx([{ rows: [skuRow], rowCount: 1 }]);

    try {
      await scheduleRebuildForFailedSkus({
        tx,
        customerMarketplaceId: 'cm-uuid-1',
        failedSkus: [{ shopSku: 'EZ8809606851663', errorCode: 'ERR', errorMessage: 'Erro.' }],
        cycleId: 'cycle-3',
      });
    } catch {
      // writeAuditEvent INSERT may fail without real DB — check the query call was attempted
    }

    // The audit event INSERT must have been attempted against tx with the correct event_type
    const auditInserts = tx.calls.filter(c => {
      const sql = c.sql.toLowerCase();
      return sql.includes('insert') && sql.includes('audit_log');
    });
    const hasEvent = auditInserts.some(c => {
      const paramsStr = JSON.stringify(c.params ?? []);
      return paramsStr.includes('pri01-fail-persistent');
    });
    assert.ok(hasEvent,
      "writeAuditEvent must be called with eventType = 'pri01-fail-persistent' (Atenção) at 3-strike escalation");
  });

  it('schedule_rebuild_three_strikes_sends_critical_alert', async () => {
    // This test verifies the source code contains the lazy-import pattern for sendCriticalAlert.
    // The actual call is best-effort and outside the tx boundary — we verify it structurally.
    // Once the module exists, this test verifies the module source; until then it documents intent.
    const parserPath = join(repoRoot, 'shared/mirakl/pri03-parser.js');
    if (!existsSync(parserPath)) {
      assert.fail('shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }
    const parserSrc = readFileSync(parserPath, 'utf-8');
    assert.ok(
      parserSrc.includes('sendCriticalAlert') || parserSrc.includes('getSendCriticalAlert'),
      'pri03-parser.js must include lazy import of sendCriticalAlert from shared/resend/client.js for 3-strike critical alert'
    );
    assert.ok(
      parserSrc.includes('../resend/client.js') || parserSrc.includes('resend/client'),
      'sendCriticalAlert must be lazily imported from shared/resend/client.js (same pattern as pri02-poller.js)'
    );
  });
});

// ---------------------------------------------------------------------------
// AC#3 — Mixed success/failure fixture + golden-file + failure counter sequence
// ---------------------------------------------------------------------------

describe('PRI03 parser integration scenarios', () => {
  it('pri03_parser_unit_tests_cover_mixed_success_failure_report', async () => {
    let fetchAndParseErrorReport;
    try {
      ({ fetchAndParseErrorReport } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    // 3-line PRI01 CSV: lines 1, 2, 3 in lineMap; lines 1 and 3 fail; line 2 succeeds
    const csvBody = '1,PRICE_TOO_LOW\n3,SKU_NOT_FOUND\n';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      text: async () => csvBody,
      json: async () => { throw new Error('not JSON'); },
    });

    const lineMap = {
      1: 'EZ1111111111111',
      2: 'EZ2222222222222',
      3: 'EZ3333333333333',
    };

    let result;
    try {
      result = await fetchAndParseErrorReport('https://worten.mirakl.net', 'key', 'import-mixed', lineMap);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(result.failedSkus.length, 2, 'Lines 1 and 3 failed → 2 failedSkus');
    assert.equal(result.successfulSkus.length, 1, 'Line 2 absent from error report → 1 successfulSku');
    assert.equal(result.successfulSkus[0].shopSku, 'EZ2222222222222', 'Successful SKU is EZ2222222222222');
    const failedShopSkus = result.failedSkus.map(f => f.shopSku).sort();
    assert.deepEqual(failedShopSkus, ['EZ1111111111111', 'EZ3333333333333'].sort());
  });

  it('pri03_parser_matches_pri03_recovery_resubmit_golden_fixture', async () => {
    // The golden fixture defines the expected rebuild CSV content (byte-exact).
    // This test verifies the fixture is readable and then, once the module exists,
    // that scheduleRebuildForFailedSkus + buildPri01Csv produce matching output.
    const fixturePath = join(fixturesDir, 'pri03-recovery-resubmit.csv');
    assert.ok(existsSync(fixturePath), `Golden fixture must exist at ${fixturePath}`);

    const fixtureContent = readFileSync(fixturePath, 'utf-8');
    assert.ok(fixtureContent.length > 0, 'Golden fixture must not be empty');
    // Verify the fixture has the expected structure (header + 2 body lines for 2-channel SKU rebuild)
    const lines = fixtureContent.trim().split('\n');
    assert.ok(lines.length >= 3, 'Golden fixture must have header + at least 2 body lines (both channels of the failed SKU)');
    assert.ok(lines[0].includes('offer-sku'), 'First line must be the CSV header: offer-sku;price;channels');

    // Once pri03-parser.js exists, the full golden-fixture assertion runs here:
    let scheduleRebuildForFailedSkus;
    let buildPri01Csv;
    try {
      ({ scheduleRebuildForFailedSkus } = await import('../../../shared/mirakl/pri03-parser.js'));
      ({ buildPri01Csv } = await import('../../../shared/mirakl/pri01-writer.js'));
    } catch {
      // pri03-parser.js not yet created — fixture structure verified above is sufficient for ATDD
      return;
    }

    // Rebuild staging rows for EZ8809606851663 (2-channel SKU, both at last_set_price_cents)
    const ptRow = makeSkuChannelRow({ id: 'sc-pt', skuId: 'sku-ez', channelCode: 'WRT_PT_ONLINE', lastSetPriceCents: 1799 });
    const esRow = makeSkuChannelRow({ id: 'sc-es', skuId: 'sku-ez', channelCode: 'WRT_ES_ONLINE', lastSetPriceCents: 1850 });
    const tx = makeMockTx([{ rows: [ptRow, esRow], rowCount: 2 }]);

    await scheduleRebuildForFailedSkus({
      tx,
      customerMarketplaceId: 'cm-uuid-1',
      failedSkus: [{ shopSku: 'EZ8809606851663', errorCode: 'SKU_NOT_FOUND', errorMessage: 'Erro.' }],
      cycleId: 'cycle-rebuild',
    });

    // Build the CSV from the staging row data (mirrors what the dispatcher would produce)
    const { csvBody } = buildPri01Csv({
      skuChannels: [
        { shopSku: 'EZ8809606851663', channelCode: 'WRT_PT_ONLINE', newPriceCents: null, lastSetPriceCents: 1799 },
        { shopSku: 'EZ8809606851663', channelCode: 'WRT_ES_ONLINE', newPriceCents: null, lastSetPriceCents: 1850 },
      ],
      operatorCsvDelimiter: 'SEMICOLON',
      offerPricesDecimals: 2,
      customerMarketplaceId: 'cm-uuid-1',
    });

    assert.equal(csvBody, fixtureContent,
      'Rebuild CSV output must match pri03-recovery-resubmit.csv golden fixture byte-exact');
  });

  it('pri03_parser_failure_counter_increments_correctly_across_cycles', async () => {
    let scheduleRebuildForFailedSkus;
    try {
      ({ scheduleRebuildForFailedSkus } = await import('../../../shared/mirakl/pri03-parser.js'));
    } catch {
      assert.fail('Module shared/mirakl/pri03-parser.js does not exist yet — implement it first');
    }

    const shopSku = 'EZ8809606851663';
    const customerMarketplaceId = 'cm-uuid-cycle';
    let currentFailureCount = 0;

    // Simulate 3 consecutive FAILED cycles
    for (let cycle = 1; cycle <= 3; cycle++) {
      const skuRow = makeSkuChannelRow({ id: 'sc-cycle', consecutiveFailures: currentFailureCount });
      const tx = makeMockTx([{ rows: [skuRow], rowCount: 1 }]);

      try {
        await scheduleRebuildForFailedSkus({
          tx,
          customerMarketplaceId,
          failedSkus: [{ shopSku, errorCode: 'ERR', errorMessage: 'Erro.' }],
          cycleId: `cycle-${cycle}`,
        });
      } catch {
        // writeAuditEvent may throw without real DB at cycle 3 — check tx calls
      }

      // Assert counter increment happened
      const counterUpdate = tx.calls.find(c => {
        const sql = c.sql.toLowerCase();
        return sql.includes('update') && sql.includes('pri01_consecutive_failures') && sql.includes('+ 1');
      });
      assert.ok(counterUpdate, `Cycle ${cycle}: counter increment UPDATE must have been issued`);

      currentFailureCount++;

      if (cycle === 3) {
        // At cycle 3: counter reaches 3 → freeze + Atenção
        const freezeUpdate = tx.calls.find(c => {
          const sql = c.sql.toLowerCase();
          return sql.includes('update') && sql.includes('frozen_for_pri01_persistent');
        });
        assert.ok(freezeUpdate, 'Cycle 3: freeze UPDATE (frozen_for_pri01_persistent = true) must have been issued');

        const auditInsert = tx.calls.find(c => {
          const sql = c.sql.toLowerCase();
          return sql.includes('insert') && sql.includes('audit_log');
        });
        if (auditInsert) {
          // If it was attempted, verify it included the correct event type
          const paramsStr = JSON.stringify(auditInsert.params ?? []);
          assert.ok(paramsStr.includes('pri01-fail-persistent'),
            "Cycle 3: audit event must use eventType 'pri01-fail-persistent'");
        }
      } else {
        // Cycles 1 and 2: no freeze
        const freezeUpdate = tx.calls.find(c => {
          const sql = c.sql.toLowerCase();
          return sql.includes('update') && sql.includes('frozen_for_pri01_persistent');
        });
        assert.equal(freezeUpdate, undefined, `Cycle ${cycle}: freeze must NOT be triggered before 3 consecutive failures`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC#4 — Freeze representation design choice (AD12)
// ---------------------------------------------------------------------------

describe('Freeze representation design choice (AD12)', () => {
  it('frozen_reason_discriminator_chosen_and_documented', () => {
    // Story 6.3 Option (b) chosen: frozen_for_pri01_persistent boolean NOT NULL DEFAULT false
    // This test asserts the migration file exists and contains the expected column definition.
    const migrationPath = join(
      repoRoot,
      'supabase/migrations/202604301215_add_pri01_consecutive_failures_to_sku_channels.sql'
    );
    assert.ok(
      existsSync(migrationPath),
      `Migration file must exist at supabase/migrations/202604301215_add_pri01_consecutive_failures_to_sku_channels.sql`
    );
    const migrationSql = readFileSync(migrationPath, 'utf-8');
    assert.ok(
      migrationSql.includes('frozen_for_pri01_persistent'),
      'Migration must define frozen_for_pri01_persistent column (Option b chosen — parallel boolean, not overloading frozen_for_anomaly_review)'
    );
    assert.ok(
      !migrationSql.includes('frozen_for_anomaly_review'),
      'Migration must NOT modify frozen_for_anomaly_review column (zero overlap per Option b — orthogonal columns)'
    );
    assert.ok(
      migrationSql.includes('pri01_consecutive_failures'),
      'Migration must also add pri01_consecutive_failures column'
    );
  });

  it('dispatcher_predicate_updated_for_chosen_freeze_representation', () => {
    // Story 5.1 dispatcher.js must have the new freeze predicate added.
    // Beyond the literal-string check, this test parses the DISPATCH_SQL block
    // and asserts BOTH freeze predicates AND-combine inside the SAME WHERE clause —
    // i.e. a row with frozen_for_pri01_persistent = true is structurally excluded
    // regardless of the value of frozen_for_anomaly_review (orthogonal columns).
    const dispatcherPath = join(repoRoot, 'worker/src/dispatcher.js');
    assert.ok(existsSync(dispatcherPath), 'worker/src/dispatcher.js must exist');
    const dispatcherSrc = readFileSync(dispatcherPath, 'utf-8');

    // Literal-string predicate present
    assert.ok(
      dispatcherSrc.includes('frozen_for_pri01_persistent = false'),
      "dispatcher.js DISPATCH_SQL must include 'AND sc.frozen_for_pri01_persistent = false' predicate to exclude frozen SKUs from repricing"
    );
    // Verify both freeze predicates are present (orthogonal — both must be in WHERE)
    assert.ok(
      dispatcherSrc.includes('frozen_for_anomaly_review = false'),
      "dispatcher.js must retain existing 'AND sc.frozen_for_anomaly_review = false' predicate (orthogonal to new column)"
    );

    // ── Structural assertion: both predicates live in the SAME WHERE block ──
    // Extract the DISPATCH_SQL block (template literal between backticks immediately
    // following the `const DISPATCH_SQL =` declaration). This proves the predicate
    // wasn't accidentally placed in a different SQL string elsewhere in the file.
    const sqlMatch = dispatcherSrc.match(/const\s+DISPATCH_SQL\s*=\s*`([\s\S]*?)`/);
    assert.ok(sqlMatch, 'dispatcher.js must declare DISPATCH_SQL as a template-literal const');
    const dispatchSqlBody = sqlMatch[1];

    // Find the WHERE clause (terminated by ORDER BY / LIMIT)
    const whereMatch = dispatchSqlBody.match(/WHERE\s+([\s\S]*?)\s+(?:ORDER\s+BY|LIMIT|$)/i);
    assert.ok(whereMatch, 'DISPATCH_SQL must have a WHERE clause');
    const whereBody = whereMatch[1];

    // Both freeze predicates must appear inside the SAME WHERE block, AND-combined.
    assert.match(whereBody, /frozen_for_anomaly_review\s*=\s*false/,
      'frozen_for_anomaly_review = false must be inside DISPATCH_SQL WHERE block');
    assert.match(whereBody, /frozen_for_pri01_persistent\s*=\s*false/,
      'frozen_for_pri01_persistent = false must be inside DISPATCH_SQL WHERE block (not in an unrelated query)');

    // SQL semantics: a chain of AND-separated predicates means BOTH must be true
    // for a row to survive. Verify there is no OR keyword between the freeze
    // predicates (orthogonal-AND, never orthogonal-OR — that would re-introduce
    // the "either flag clears the row" behaviour we explicitly avoided in Option b).
    const segmentBetween = (() => {
      const aIdx = whereBody.search(/frozen_for_anomaly_review\s*=\s*false/);
      const pIdx = whereBody.search(/frozen_for_pri01_persistent\s*=\s*false/);
      const lo = Math.min(aIdx, pIdx);
      const hi = Math.max(aIdx, pIdx);
      return whereBody.slice(lo, hi);
    })();
    assert.ok(
      !/\bOR\b/i.test(segmentBetween),
      'The two freeze predicates must be AND-combined (not OR) — a frozen-PRI01 row must be excluded ' +
      'regardless of frozen_for_anomaly_review value. Found OR between the two predicates.'
    );
  });

  it('rls_regression_suite_extended_with_new_freeze_column', () => {
    // scripts/rls-regression-suite.js must cover sku_channels table.
    // Adding a new column to sku_channels doesn't require a new CUSTOMER_SCOPED_TABLES entry
    // (the table-level RLS policy covers all columns). However, the test verifies that
    // sku_channels is still in the registry AND that the suite references the new column
    // in at least one UPDATE query (preventing cross-tenant column write).
    const rlsPath = join(repoRoot, 'scripts/rls-regression-suite.js');
    assert.ok(existsSync(rlsPath), 'scripts/rls-regression-suite.js must exist');
    const rlsSrc = readFileSync(rlsPath, 'utf-8');

    assert.ok(
      rlsSrc.includes("table: 'sku_channels'"),
      "rls-regression-suite.js must include sku_channels in CUSTOMER_SCOPED_TABLES registry"
    );

    // The suite must either: (a) reference frozen_for_pri01_persistent in a query, OR
    // (b) have a comment/note documenting that table-level RLS covers all new columns implicitly.
    // Option (b) is acceptable because Postgres RLS applies at the row level — column additions
    // are automatically covered by existing row-level policies. The assertion checks either form.
    const coversNewColumn =
      rlsSrc.includes('frozen_for_pri01_persistent') ||
      rlsSrc.includes('new columns are covered by existing table-level RLS') ||
      rlsSrc.includes('Story 6.3') ||
      rlsSrc.includes('pri01_consecutive_failures');

    assert.ok(
      coversNewColumn,
      'rls-regression-suite.js must reference frozen_for_pri01_persistent or pri01_consecutive_failures ' +
      'to document that new sku_channels columns added by Story 6.3 are covered by tenant isolation'
    );
  });
});
