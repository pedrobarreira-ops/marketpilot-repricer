# Story 3.3: mirakl-empirical-verify Smoke-Test Script — Reusable for First-Customer Onboarding

Endpoints verified against Mirakl MCP and architecture-distillate empirical facts (2026-05-06).

**Sprint-status key:** `3-3-mirakl-empirical-verify-smoke-test-script-reusable-for-first-customer-onboarding`
**Status:** ready-for-dev
**Size:** S
**Epic:** Epic 3 — Mirakl Integration Foundation (architecture S-I phase 3)

---

## Narrative

**As a** BAD subagent implementing Story 4.3 (key entry inline validation) and Story 4.4 (onboarding catalog scan orchestration),
**I want** a rewritten `scripts/mirakl-empirical-verify.js` that uses the Story 3.2 endpoint wrappers (a01.js, pc01.js, of21.js, p11.js), exports a reusable `runVerification` function, and writes structured output to `verification-results.json`,
**So that** Pedro can run `npm run mirakl:verify` to validate any seller's Worten credentials, Story 4.3 can reuse the inline-validation path for the 5-second key check, and Story 4.4 can run the full smoke test before starting the catalog scan.

---

## Trace

- **Architecture decisions:** AD5 (api-client SSoT), AD6 (channel_pricing SINGLE per Worten), AD13 (self-filter), AD14 (mandatory filters), AD16 (onboarding smoke test sequence: A01 → PC01 → OF21 → P11)
- **Functional requirements:** Foundation for FR9 (5s inline P11 validation), Story 4.4 onboarding gate
- **Non-functional requirements:** NFR-P6 (5s key validation budget), NFR-I1 (Mirakl reliability)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/01-epics-1-3-foundation-tenancy-mirakl.md`, Story 3.3
- **Architecture patterns:** `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md`
- **Architecture decisions detail:** `_bmad-output/planning-artifacts/architecture-distillate/02-decisions-A-D.md` — AD5, AD6, AD13, AD14, AD16

---

## Critical Context: This Is a REWRITE, Not a New File

`scripts/mirakl-empirical-verify.js` **already exists** — it is the original pre-Epic-3 raw verification script written before Story 3.1/3.2 existed. It uses raw `fetch()` directly (violating the `no-direct-fetch` ESLint rule) and does not use the endpoint wrappers.

**Story 3.3 rewrites this file** to:
1. Use the Story 3.2 wrappers (`getAccount`, `getPlatformConfiguration`, `getOffers`, `getProductOffersByEan` from `shared/mirakl/`)
2. Export a `runVerification(opts)` function reusable by Stories 4.3 and 4.4
3. Write `verification-results.json` with masked apiKey hash (NOT plaintext key)
4. Add `npm run mirakl:verify` script to `package.json`

The `no-direct-fetch` ESLint rule (from Story 3.1) **will catch any direct `fetch(` calls** in the rewritten script if it is placed under `shared/` or `worker/` or `app/`. However, `scripts/` is not in the ESLint scan scope — the original script currently lives in `scripts/` and uses raw `fetch()`. The rewrite MUST NOT use raw `fetch()` either — it delegates to the wrappers which internally use `mirAklGet`.

**Important security constraint from the original script:** API key is NEVER printed, logged, or echoed. Output uses a masked hash of the apiKey only.

---

## Dependencies

- **Story 3.1** (DONE): `shared/mirakl/api-client.js` exports `mirAklGet`, `MiraklApiError`; `eslint-rules/no-direct-fetch.js` active
- **Story 3.2** (DONE): `shared/mirakl/a01.js`, `pc01.js`, `of21.js`, `p11.js`, `self-filter.js` all implemented and tested

**Enables:**
- Story 4.3 (key entry inline validation) — calls `runVerification` with single P11 call within 5s budget
- Story 4.4 (onboarding catalog scan) — calls `runVerification` full sequence before catalog fan-out

---

## Pre-Existing Test Scaffold

The test file is **already committed** — do NOT recreate or modify it:

- `tests/scripts/mirakl-empirical-verify.test.js` — 13 structural + integration tests

The test covers:
- File exists at `scripts/mirakl-empirical-verify.js`
- Exports `runVerification` or `verifyMiraklConnection` or similar async function
- Calls A01 before PC01 (source-order check)
- Calls OF21 (getOffers / getAllOffers / `/api/offers`)
- Calls P11 (getProductOffersByEan / `/api/products/offers`)
- Asserts `EUR` currency
- Asserts `OPEN` state
- Asserts `SINGLE` channel_pricing
- Handles `DISABLED` channel_pricing with abort
- Never logs apiKey (uses hash/masked)
- Exports a single-EAN inline validation function
- `package.json` has `mirakl:verify` script
- `.gitignore` includes `verification-results.json`
- Smoke-test sequence passes against mock server (calls `createMiraklMockServer` from `tests/mocks/mirakl-server.js`)

The mock-server-based integration tests call `runVerification({ baseUrl, apiKey, referenceEan, channel, dryRun: true })` — match this signature exactly.

---

## SSoT Modules Consumed (Do NOT reimplement)

| Import | From |
|--------|------|
| `getAccount` | `../shared/mirakl/a01.js` |
| `getPlatformConfiguration` | `../shared/mirakl/pc01.js` |
| `getOffers` | `../shared/mirakl/of21.js` |
| `getProductOffersByEan` | `../shared/mirakl/p11.js` |
| `filterCompetitorOffers` | `../shared/mirakl/self-filter.js` (optional, for AC1 P11 filter assertion) |

**Do NOT use raw `fetch()`.** All HTTP calls go through the wrappers which use `mirAklGet` internally.

---

## Empirical Facts (Pre-Verified — Do Not Guess)

From `architecture-distillate/_index.md` Cross-Cutting Empirically-Verified Mirakl Facts:

- Worten `channel_pricing` is `SINGLE` (PC01) — engine writes one price per (SKU, channel)
- Worten `operator_csv_delimiter` is `SEMICOLON` (PC01)
- Worten `offer_prices_decimals` is `2` (PC01)
- P11 placeholder offers with `total_price = 0` returned in production — engine MUST filter `o.total_price > 0`
- `shop_id` is `null` in P11 competitor offers — `shop_name` is the only reliable self-identification key
- P11 batch lookup uses `product_references=EAN|xxx` NOT `product_ids`
- Worten Mirakl auth header is raw `Authorization: <api_key>` — NO `Bearer` prefix (handled by `mirAklGet`)
- A01 returns `shop_id`, `shop_name`, `channels[]`, `currency_iso_code`, `state`
- Channel codes: `WRT_PT_ONLINE` / `WRT_ES_ONLINE`
- OF21 uses offset-based pagination (NOT cursor/pageToken string)

---

## Acceptance Criteria

### AC1 — Full smoke-test sequence: A01 → PC01 → OF21 → P11

**Given** `scripts/mirakl-empirical-verify.js` exports `runVerification(opts)`
**When** run with valid credentials via `npm run mirakl:verify` (using `.env.local`)
**Then** the script runs in this order:
1. `getAccount(baseUrl, apiKey)` → asserts `shop_id` present, `currency_iso_code === 'EUR'`, `state === 'OPEN'`
2. `getPlatformConfiguration(baseUrl, apiKey)` → asserts `channel_pricing === 'SINGLE'`; if `channel_pricing === 'DISABLED'` aborts with PT message: *"A configuração de preços está desativada neste marketplace. O MarketPilot não consegue operar."*; asserts `operator_csv_delimiter` and `offer_prices_decimals` populated
3. `getOffers(baseUrl, apiKey, { offset: 0, pageSize: 1 })` → asserts at least 1 offer returned with `shop_sku` populated
4. `getProductOffersByEan(baseUrl, apiKey, { ean, channel: 'WRT_PT_ONLINE', pricingChannelCode: 'WRT_PT_ONLINE' })` → asserts that after applying `active === true` and `total_price > 0` filters, the result is either empty (no competitors on this EAN) or contains offers with valid `total_price > 0`

Reports pass/fail per assertion. Non-critical assertions (OF21 empty, P11 no competitors) are warnings, not failures.

**And** the script writes structured output to `verification-results.json` (only when `dryRun !== true`):
- `timestamp` (ISO string)
- `apiKeyHash` (SHA-256 hex of apiKey, truncated to 16 chars — NOT the apiKey)
- Per-call: `{ status, ok, latency_ms, assertions: [...{ label, passed, value }] }`

### AC2 — Inline validation path for Story 4.3 (5s budget)

**Given** `runVerification` is exported as a named ES module export
**When** Story 4.3 imports and calls `runVerification({ baseUrl, apiKey, referenceEan, channel, dryRun: true })`
**Then** only the P11 call fires (lightweight subset of full smoke test) within the 5-second budget per NFR-P6
**And** Story 4.4 imports and calls `runVerification({ baseUrl, apiKey, referenceEan, channel })` to run the full A01 → PC01 → OF21 → P11 sequence before catalog fan-out
**And** the function returns `{ success: boolean, results: [...] }` — Story 4.3 uses `success` to gate the form submission

**Implementation guidance:** Accept `opts.inlineOnly = true` (or similar flag) to skip OF21 and run only A01 + PC01 + P11 for the inline validation path. The test calls with `dryRun: true` — honor that to skip writing `verification-results.json`. Both flags may be present simultaneously.

### AC3 — verification-results.json output contract

**Given** the script is run without `dryRun: true`
**When** it completes successfully
**Then** `verification-results.json` is written to the project root containing:
- `timestamp` (ISO 8601 datetime string)
- `apiKeyHash` (string — masked SHA-256 of apiKey, first 16 hex chars only)
- `results[]` — per-call objects: `{ call: 'A01'|'PC01'|'OF21'|'P11', status, ok, latency_ms, assertions: [{ label, passed, value }] }`
- `success: boolean` — true only if all required assertions passed

**And** `verification-results.json` is listed in `.gitignore` (already confirmed present — do not remove)
**And** the apiKey is NEVER present in the output file

### AC4 — package.json `mirakl:verify` script

**Given** `package.json`
**When** I inspect `scripts`
**Then** `mirakl:verify` entry is present: `"node --env-file=.env.local scripts/mirakl-empirical-verify.js"`

### AC5 — Test suite passes

**Given** the test scaffold at `tests/scripts/mirakl-empirical-verify.test.js`
**When** `node --test tests/scripts/mirakl-empirical-verify.test.js` runs
**Then** all 13 structural and mock-server integration tests pass

---

## File-Touch List

### Modified files

| File | Change |
|------|--------|
| `scripts/mirakl-empirical-verify.js` | **Rewrite** — replace raw-fetch original with wrapper-based ES module that exports `runVerification` |
| `package.json` | Add `"mirakl:verify": "node --env-file=.env.local scripts/mirakl-empirical-verify.js"` to `scripts` |

### Pre-existing (do NOT modify)

| File | Status |
|------|--------|
| `tests/scripts/mirakl-empirical-verify.test.js` | ALREADY EXISTS — complete test scaffold; do not change |
| `tests/mocks/mirakl-server.js` | ALREADY EXISTS — mock server; do not change |
| `shared/mirakl/a01.js` | ALREADY EXISTS — use `getAccount` |
| `shared/mirakl/pc01.js` | ALREADY EXISTS — use `getPlatformConfiguration` |
| `shared/mirakl/of21.js` | ALREADY EXISTS — use `getOffers` |
| `shared/mirakl/p11.js` | ALREADY EXISTS — use `getProductOffersByEan` |
| `shared/mirakl/self-filter.js` | ALREADY EXISTS — optionally use `filterCompetitorOffers` |
| `.gitignore` | ALREADY HAS `verification-results.json` — do not touch |

---

## Implementation Guide

### Module Shape Required by Tests

The test file imports the module and tries `mod.runVerification ?? mod.verifyMiraklConnection ?? mod.default`. Use `runVerification` as the primary export name.

```js
// scripts/mirakl-empirical-verify.js
// ES module — 'use strict' is implicit in ESM; but scripts/ is CJS-ish
// The original was CJS. Check package.json "type": "module" — if "module",
// script must use ESM imports. If not set or "commonjs", use require() or
// add 'type: module' to this file via .mjs extension or top-level "type".
// Given the project uses "type": "module" in package.json (JS-ESM), use ESM.

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

/**
 * @typedef {Object} VerificationResult
 * @property {boolean} success
 * @property {string} apiKeyHash - SHA-256 hex, first 16 chars only (NOT the key)
 * @property {string} timestamp
 * @property {VerificationCallResult[]} results
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
 * @typedef {Object} VerificationAssertion
 * @property {string} label
 * @property {boolean} passed
 * @property {*} value
 */

/**
 * Run the Mirakl empirical verification sequence.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl - Worten Mirakl base URL (e.g. https://marketplace.worten.pt)
 * @param {string} opts.apiKey - Worten shop API key (never logged or written to output)
 * @param {string} opts.referenceEan - EAN from seller's catalog for P11 validation
 * @param {string} [opts.channel='WRT_PT_ONLINE'] - Channel code for P11 call
 * @param {boolean} [opts.dryRun=false] - If true, skip writing verification-results.json
 * @param {boolean} [opts.inlineOnly=false] - If true, run only P11 (5s inline validation path for Story 4.3)
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
  const apiKeyHash = createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  const results = [];
  let allRequired = true;

  // Helper: run a call with timing and assertion collection
  async function runCall (label, callFn, assertFn) {
    const start = performance.now();
    let body, status, ok;
    try {
      body = await callFn();
      status = 200;
      ok = true;
    } catch (err) {
      status = err?.status ?? 0;
      ok = false;
      body = null;
    }
    const latency_ms = Math.round(performance.now() - start);
    const assertions = assertFn(body, ok);
    const requiredFailed = assertions.filter(a => a.required && !a.passed);
    if (requiredFailed.length > 0) allRequired = false;
    results.push({ call: label, status, ok, latency_ms, assertions });
    return { body, ok };
  }

  // ── Inline-only path (Story 4.3: single P11 call within 5s budget) ──────────
  if (inlineOnly) {
    await runCall('P11', () => getProductOffersByEan(baseUrl, apiKey, {
      ean: referenceEan,
      channel,
      pricingChannelCode: channel,
    }), (body, ok) => {
      const filtered = ok && Array.isArray(body) ? filterCompetitorOffers(body, '__self__').filteredOffers : [];
      return [
        { label: 'P11 call succeeded', passed: ok, value: ok, required: true },
        { label: 'P11 returns valid data', passed: ok && Array.isArray(body), value: ok, required: false },
      ];
    });
    const result = { success: allRequired, apiKeyHash, timestamp, results };
    if (!dryRun) await writeResult(result);
    return result;
  }

  // ── Full sequence: A01 → PC01 → OF21 → P11 ──────────────────────────────────

  // 1. A01
  const { body: a01Body, ok: a01Ok } = await runCall('A01',
    () => getAccount(baseUrl, apiKey),
    (body, ok) => [
      { label: 'A01 call succeeded', passed: ok, value: ok, required: true },
      { label: 'shop_id present', passed: ok && typeof body?.shop_id !== 'undefined' && body.shop_id !== null, value: body?.shop_id ?? null, required: true },
      { label: 'currency_iso_code === EUR', passed: ok && body?.currency_iso_code === 'EUR', value: body?.currency_iso_code ?? null, required: true },
      { label: 'state === OPEN', passed: ok && (body?.shop_state === 'OPEN' || body?.state === 'OPEN'), value: body?.shop_state ?? body?.state ?? null, required: true },
    ]
  );

  // 2. PC01
  const { body: pc01Body, ok: pc01Ok } = await runCall('PC01',
    () => getPlatformConfiguration(baseUrl, apiKey),
    (body, ok) => {
      const channelPricing = body?.channel_pricing ?? null;
      if (ok && channelPricing === 'DISABLED') {
        // Abort-loudly per AC1 — PC01 DISABLED means MarketPilot cannot operate
        process.stderr.write('ERRO: A configuração de preços está desativada neste marketplace. O MarketPilot não consegue operar.\n');
        allRequired = false;
      }
      return [
        { label: 'PC01 call succeeded', passed: ok, value: ok, required: true },
        { label: 'channel_pricing === SINGLE', passed: ok && channelPricing === 'SINGLE', value: channelPricing, required: true },
        { label: 'channel_pricing !== DISABLED', passed: ok && channelPricing !== 'DISABLED', value: channelPricing, required: true },
        { label: 'operator_csv_delimiter populated', passed: ok && body?.operator_csv_delimiter != null, value: body?.operator_csv_delimiter ?? null, required: true },
        { label: 'offer_prices_decimals populated', passed: ok && body?.offer_prices_decimals != null, value: body?.offer_prices_decimals ?? null, required: true },
      ];
    }
  );

  // 3. OF21 — first page only (pageSize: 1)
  await runCall('OF21',
    () => getOffers(baseUrl, apiKey, { offset: 0, pageSize: 1 }),
    (body, ok) => {
      const offers = body?.offers ?? [];
      const firstOffer = offers[0] ?? null;
      return [
        { label: 'OF21 call succeeded', passed: ok, value: ok, required: true },
        { label: 'OF21 returned ≥1 offer', passed: ok && offers.length >= 1, value: offers.length, required: false },
        { label: 'first offer has shop_sku', passed: ok && typeof firstOffer?.shop_sku === 'string' && firstOffer.shop_sku.length > 0, value: firstOffer?.shop_sku ?? null, required: false },
      ];
    }
  );

  // 4. P11 — one EAN + channel
  await runCall('P11',
    () => getProductOffersByEan(baseUrl, apiKey, {
      ean: referenceEan,
      channel,
      pricingChannelCode: channel,
    }),
    (body, ok) => {
      const raw = Array.isArray(body) ? body : [];
      const { filteredOffers } = filterCompetitorOffers(raw, a01Body?.shop_name ?? '__unknown__');
      return [
        { label: 'P11 call succeeded', passed: ok, value: ok, required: true },
        { label: 'all filtered P11 offers have total_price > 0', passed: filteredOffers.every(o => Number.isFinite(o.total_price) && o.total_price > 0), value: filteredOffers.length, required: false },
      ];
    }
  );

  const result = { success: allRequired, apiKeyHash, timestamp, results };
  if (!dryRun) await writeResult(result);
  return result;
}

/**
 * Write structured output to verification-results.json in project root.
 * @param {VerificationResult} result
 */
async function writeResult (result) {
  const outPath = join(PROJECT_ROOT, 'verification-results.json');
  await writeFile(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
}

// ── CLI entry point ──────────────────────────────────────────────────────────

// Only run as CLI when this file is the entry point
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
    process.stderr.write('ERROR: WORTEN_TEST_EAN must be 8–14 digits.\n');
    process.exit(1);
  }

  runVerification({ baseUrl, apiKey, referenceEan }).then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.success) process.exit(1);
  }).catch(err => {
    process.stderr.write(`FATAL: ${err?.message ?? 'unknown error'}\n`);
    process.exit(3);
  });
}
```

**Note on `OPEN` / `state` field:** The architecture-distillate empirical facts note that A01 returns `state` (not confirmed as `shop_state`). The mock fixture uses `shop_state: 'OPEN'`. The test asserts `account.shop_state === 'OPEN'` (from the mock-server integration test). Check both fields defensively: `body?.shop_state === 'OPEN' || body?.state === 'OPEN'`.

**Note on DISABLED abort:** The PT message abort writes to stderr and sets `allRequired = false`, but does NOT call `process.exit()` from within `runVerification` — callers must check `result.success` and act accordingly. The CLI entry point calls `process.exit(1)` when `!result.success`. This keeps `runVerification` testable without process exit side-effects.

---

## Critical Constraints (Do Not Violate)

1. **No raw `fetch()`.** All HTTP calls via `getAccount`, `getPlatformConfiguration`, `getOffers`, `getProductOffersByEan`. The original script's `safeGet()` using raw `fetch` MUST be removed.

2. **apiKey NEVER in output.** Only a 16-char SHA-256 hex prefix appears in `verification-results.json` and never in stdout/stderr.

3. **Named ES module exports.** `export async function runVerification` — no `export default`. Project uses `"type": "module"` in `package.json`.

4. **No `console.log`.** The project-wide ESLint `no-console` rule applies. Use `process.stdout.write()` for output and `process.stderr.write()` for errors (as in the original script). The scripts/ directory may be outside ESLint scope but maintain the convention.

5. **No `.then()` chains.** async/await only.

6. **Export name must be `runVerification`.** The test file tries `mod.runVerification ?? mod.verifyMiraklConnection ?? mod.default` — use `runVerification` as the primary export.

7. **`dryRun: true` skips writing `verification-results.json`.** The mock-server tests pass `dryRun: true` — honor it.

8. **Do NOT remove `.gitignore` entry.** `verification-results.json` must remain gitignored.

9. **Do NOT touch test files or mock server.** `tests/scripts/mirakl-empirical-verify.test.js` and `tests/mocks/mirakl-server.js` are pre-existing scaffolds.

---

## Pattern Compliance Checklist

Before marking done:

- [ ] `scripts/mirakl-empirical-verify.js` — no `export default`, no `fetch(` calls, no `console.log`, async/await only, JSDoc on exported `runVerification`
- [ ] `runVerification` exports correctly — test can import `mod.runVerification`
- [ ] A01 called before PC01 in source (source-order check in test)
- [ ] OF21 call present (test scans for `getOffers` / `getAllOffers` / `/api/offers`)
- [ ] P11 call present (test scans for `getProductOffersByEan` / `/api/products/offers`)
- [ ] `OPEN` literal present in source (state assertion)
- [ ] `EUR` literal present in source (currency assertion)
- [ ] `SINGLE` literal present in source (channel_pricing assertion)
- [ ] `DISABLED` literal present in source (abort branch)
- [ ] `hash` or `masked` or similar literal near apiKey handling (key masking assertion)
- [ ] `package.json` has `"mirakl:verify"` script
- [ ] `verification-results.json` still in `.gitignore`
- [ ] `node --test tests/scripts/mirakl-empirical-verify.test.js` — all 13 tests pass
- [ ] ESLint 0 errors on `scripts/mirakl-empirical-verify.js` (if in ESLint scope)

---

## Previous Story Intelligence (Story 3.2)

Story 3.2 (DONE) established:

- **`shared/mirakl/a01.js`** — `getAccount(baseUrl, apiKey)` → `AccountInfo` shape: `{ shop_id, shop_name, shop_state (optional), currency_iso_code, is_professional, channels, domains }`
- **`shared/mirakl/pc01.js`** — `getPlatformConfiguration(baseUrl, apiKey)` → flat normalized: `{ channel_pricing, operator_csv_delimiter, offer_prices_decimals (number), discount_period_required, competitive_pricing_tool, scheduled_pricing, volume_pricing, multi_currency, order_tax_mode, _raw }`. The mock returns flat shape directly; live Mirakl returns nested under `features.*` and the wrapper normalizes.
- **`shared/mirakl/of21.js`** — `getOffers(baseUrl, apiKey, { offset?, pageSize? })` → `{ offers: [...], pageToken: number|null }`. Uses offset-based pagination. `getAllOffers(baseUrl, apiKey)` iterates all pages.
- **`shared/mirakl/p11.js`** — `getProductOffersByEan(baseUrl, apiKey, { ean, channel, pricingChannelCode })` → raw offers array (no filtering). `getProductOffersByEanBatch` for up to 100 EANs.
- **`shared/mirakl/self-filter.js`** — `filterCompetitorOffers(rawOffers, ownShopName)` → `{ filteredOffers, collisionDetected }`.

Key implementation note from Story 3.2 code review: **source file comments must not contain `fetch(` substring** — the `no-direct-fetch` test does a plain `src.includes('fetch(')` scan. Phrase comments as "HTTP call" or "api-client" instead.

Key implementation note from Story 3.2: `catch {}` (no binding) preferred for unused bindings; import pattern uses named exports only.

---

## Source Reference: DynamicPriceIdea

`D:\Plannae Project\DynamicPriceIdea\src\workers\mirakl\` has production P11 + A01 patterns. The original `scripts/mirakl-empirical-verify.js` was the architecture-verification tool that fed `verification-results.json` before Story 3.1/3.2 were built. Story 3.3 closes the loop: the verification script now uses the production-grade wrappers it helped design.

---

## Integration Test Tag

This story does NOT require `integration_test_required: true` — the test suite runs against the mock server only (no live Supabase/Postgres dependency). The `npm run mirakl:verify` CLI is Pedro-executed manually with live credentials when needed.

---

## Dev Agent Record

### Agent Model Used

<!-- To be filled by dev agent -->

### Debug Log References

### Completion Notes List

### File List
