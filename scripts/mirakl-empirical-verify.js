// scripts/mirakl-empirical-verify.js
//
// Story 3.3: mirakl-empirical-verify smoke-test script — reusable for first-customer onboarding.
//
// READ-ONLY empirical verification of Mirakl Marketplace Platform (MMP) behavior.
// Rewrites the pre-Epic-3 raw-fetch script to use the Story 3.2 endpoint wrappers.
//
// SAFETY (these are the contract — do not relax):
//   * GET-only. No POST/PUT/PATCH/DELETE — all calls go through mirAklGet in the wrappers.
//   * Authorization header value (apiKey) is NEVER printed, logged, or echoed.
//     Output uses only a 16-char SHA-256 hex prefix as apiKeyHash.
//   * Reads credentials from environment variables. Never accepts them as
//     command-line arguments (would leak via shell history / process listing).
//   * One-shot. Exits after the run.
//
// Required environment variables (from .env.local) when run as CLI:
//   WORTEN_SHOP_API_KEY    Worten Mirakl shop API key (raw key).
//   WORTEN_INSTANCE_URL    Marketplace instance URL, e.g. https://marketplace.worten.pt
//   WORTEN_TEST_EAN        A 13-digit EAN from the seller's own catalog.
//
// Usage (loads .env.local automatically via Node >=22 --env-file flag):
//   $ node --env-file=.env.local scripts/mirakl-empirical-verify.js
//
// Node >=22 required (built-in performance API, --env-file).

import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAccount } from '../shared/mirakl/a01.js';
import { getPlatformConfiguration } from '../shared/mirakl/pc01.js';
import { getOffers } from '../shared/mirakl/of21.js';
import { getProductOffersByEan } from '../shared/mirakl/p11.js';
import { filterCompetitorOffers } from '../shared/mirakl/self-filter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Types (JSDoc only — no runtime cost)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} VerificationAssertion
 * @property {string} label
 * @property {boolean} passed
 * @property {*} value
 * @property {boolean} [required]
 */

/**
 * @typedef {Object} VerificationCallResult
 * @property {'A01'|'PC01'|'OF21'|'P11'} call
 * @property {number} status
 * @property {boolean} ok
 * @property {number} latency_ms
 * @property {VerificationAssertion[]} assertions
 */

/**
 * @typedef {Object} VerificationResult
 * @property {boolean} success
 * @property {string} apiKeyHash - SHA-256 hex, first 16 chars only (NOT the key)
 * @property {string} timestamp
 * @property {VerificationCallResult[]} results
 */

// ---------------------------------------------------------------------------
// Core: runVerification
// ---------------------------------------------------------------------------

/**
 * Run the Mirakl empirical verification sequence.
 *
 * Full sequence: A01 → PC01 → OF21 → P11 (AD16 smoke-test order)
 * Inline-only path (opts.inlineOnly): runs only P11 (skips A01, PC01, OF21) —
 * keeps Story 4.3 inline key validation within the 5s NFR-P6 budget.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl       Worten Mirakl base URL (e.g. https://marketplace.worten.pt)
 * @param {string} opts.apiKey        Worten shop API key (NEVER logged or written to output)
 * @param {string} opts.referenceEan  EAN from seller catalog for P11 validation
 * @param {string} [opts.channel='WRT_PT_ONLINE']  Channel code for P11 call
 * @param {boolean} [opts.dryRun=false]  Skip writing verification-results.json
 * @param {boolean} [opts.inlineOnly=false]  Run only P11 (5s inline path for Story 4.3)
 * @returns {Promise<VerificationResult>}
 */
export async function runVerification (opts = {}) {
  const {
    baseUrl,
    apiKey,
    referenceEan,
    channel = 'WRT_PT_ONLINE',
    dryRun = false,
    inlineOnly = false,
  } = opts;

  const timestamp = new Date().toISOString();
  // apiKey is masked: only the first 16 hex chars of its SHA-256 hash appear in output.
  const apiKeyHash = createHash('sha256').update(apiKey ?? '').digest('hex').slice(0, 16);
  const results = [];
  let allRequiredPassed = true;

  /**
   * Execute one API call, collect timing + assertions, push to results.
   * Returns { body, ok } for downstream calls that need the data.
   *
   * @param {string} label - Call name: 'A01' | 'PC01' | 'OF21' | 'P11'
   * @param {() => Promise<*>} callFn - Wrapper call
   * @param {(body: *, ok: boolean) => VerificationAssertion[]} assertFn
   */
  async function runCall (label, callFn, assertFn) {
    const start = performance.now();
    let body = null;
    let status = 0;
    let ok = false;
    try {
      body = await callFn();
      status = 200;
      ok = true;
    } catch (err) {
      status = err?.status ?? 0;
      ok = false;
    }
    const latency_ms = Math.round(performance.now() - start);
    const assertions = assertFn(body, ok);
    const requiredFailed = assertions.filter(a => a.required !== false && !a.passed);
    if (requiredFailed.length > 0) allRequiredPassed = false;
    results.push({ call: label, status, ok, latency_ms, assertions });
    return { body, ok };
  }

  // ── Inline-only path: Story 4.3 key validation (P11 call only, 5s budget) ─

  if (inlineOnly) {
    await runCall('P11',
      () => getProductOffersByEan(baseUrl, apiKey, {
        ean: referenceEan,
        channel,
        pricingChannelCode: channel,
      }),
      (body, ok) => [
        { label: 'P11 call succeeded', passed: ok, value: ok },
        { label: 'P11 returns array', passed: ok && Array.isArray(body), value: ok, required: false },
      ]
    );
    const result = { success: allRequiredPassed, apiKeyHash, timestamp, results };
    if (!dryRun) await writeResult(result);
    return result;
  }

  // ── Full sequence: A01 → PC01 → OF21 → P11 (AD16) ───────────────────────

  // 1. A01 — shop identity (must succeed; shop_id + state + currency verified)
  const { body: a01Body } = await runCall('A01',
    () => getAccount(baseUrl, apiKey),
    (body, ok) => [
      { label: 'A01 call succeeded', passed: ok, value: ok },
      { label: 'shop_id present', passed: ok && body?.shop_id != null, value: body?.shop_id ?? null },
      // Worten empirically confirmed: currency_iso_code is 'EUR'
      { label: 'currency_iso_code === EUR', passed: ok && body?.currency_iso_code === 'EUR', value: body?.currency_iso_code ?? null },
      // shop_state is 'OPEN' (Worten; check both field names defensively)
      { label: 'state === OPEN', passed: ok && (body?.shop_state === 'OPEN' || body?.state === 'OPEN'), value: body?.shop_state ?? body?.state ?? null },
    ]
  );

  // 2. PC01 — operator features (channel_pricing SINGLE confirmed for Worten)
  await runCall('PC01',
    () => getPlatformConfiguration(baseUrl, apiKey),
    (body, ok) => {
      const channelPricing = body?.channel_pricing ?? null;
      // DISABLED means MarketPilot cannot operate — write to stderr and fail
      if (ok && channelPricing === 'DISABLED') {
        process.stderr.write('ERRO: A configuração de preços está desativada neste marketplace. O MarketPilot não consegue operar.\n');
        allRequiredPassed = false;
      }
      return [
        { label: 'PC01 call succeeded', passed: ok, value: ok },
        // Worten channel_pricing empirically confirmed as SINGLE (AD6)
        { label: 'channel_pricing === SINGLE', passed: ok && channelPricing === 'SINGLE', value: channelPricing },
        { label: 'channel_pricing !== DISABLED', passed: ok && channelPricing !== 'DISABLED', value: channelPricing },
        { label: 'operator_csv_delimiter populated', passed: ok && body?.operator_csv_delimiter != null, value: body?.operator_csv_delimiter ?? null },
        { label: 'offer_prices_decimals populated', passed: ok && body?.offer_prices_decimals != null, value: body?.offer_prices_decimals ?? null },
      ];
    }
  );

  // 3. OF21 — first page of own offers (offset-based pagination confirmed by MCP)
  await runCall('OF21',
    () => getOffers(baseUrl, apiKey, { offset: 0, pageSize: 1 }),
    (body, ok) => {
      const offers = body?.offers ?? [];
      const first = offers[0] ?? null;
      return [
        { label: 'OF21 call succeeded', passed: ok, value: ok },
        // Non-critical: catalog could be empty; still a warning not a failure
        { label: 'OF21 returned >=1 offer', passed: ok && offers.length >= 1, value: offers.length, required: false },
        { label: 'first offer has shop_sku', passed: ok && typeof first?.shop_sku === 'string' && first.shop_sku.length > 0, value: first?.shop_sku ?? null, required: false },
      ];
    }
  );

  // 4. P11 — one EAN + channel (self-filter applied after call: AD13+AD14)
  await runCall('P11',
    () => getProductOffersByEan(baseUrl, apiKey, {
      ean: referenceEan,
      channel,
      pricingChannelCode: channel,
    }),
    (body, ok) => {
      const raw = Array.isArray(body) ? body : [];
      const ownName = a01Body?.shop_name ?? '__unknown__';
      const { filteredOffers } = filterCompetitorOffers(raw, ownName);
      return [
        { label: 'P11 call succeeded', passed: ok, value: ok },
        // Non-critical: no competitors on this EAN is a valid state
        { label: 'all filtered P11 offers have total_price > 0', passed: filteredOffers.every(o => Number.isFinite(o.total_price) && o.total_price > 0), value: filteredOffers.length, required: false },
      ];
    }
  );

  const result = { success: allRequiredPassed, apiKeyHash, timestamp, results };
  if (!dryRun) await writeResult(result);
  return result;
}

// ---------------------------------------------------------------------------
// Output writer
// ---------------------------------------------------------------------------

/**
 * Write structured verification output to verification-results.json in project root.
 * apiKey is never present — only the masked apiKeyHash is included.
 *
 * @param {VerificationResult} result
 */
async function writeResult (result) {
  const outPath = join(PROJECT_ROOT, 'verification-results.json');
  await writeFile(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

// Only execute when this file is the Node.js entry point (not imported as module)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const apiKey = process.env.WORTEN_SHOP_API_KEY;
  const baseUrl = process.env.WORTEN_INSTANCE_URL?.replace(/\/+$/, '');
  const referenceEan = process.env.WORTEN_TEST_EAN;

  if (!apiKey || !baseUrl || !referenceEan) {
    process.stderr.write('ERROR: WORTEN_SHOP_API_KEY, WORTEN_INSTANCE_URL, and WORTEN_TEST_EAN must be set.\n');
    process.exit(1);
  }
  if (!/^https:\/\//.test(baseUrl)) {
    process.stderr.write('ERROR: WORTEN_INSTANCE_URL must start with https://\n');
    process.exit(1);
  }
  if (!/^\d{8,14}$/.test(referenceEan)) {
    process.stderr.write('ERROR: WORTEN_TEST_EAN must be 8-14 digits.\n');
    process.exit(1);
  }

  // async IIFE — Critical Constraint #5 forbids .then() chains; use await instead.
  (async () => {
    try {
      const result = await runVerification({ baseUrl, apiKey, referenceEan });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (!result.success) process.exit(1);
    } catch (err) {
      process.stderr.write(`FATAL: ${err?.message ?? 'unknown error'}\n`);
      process.exit(3);
    }
  })();
}
