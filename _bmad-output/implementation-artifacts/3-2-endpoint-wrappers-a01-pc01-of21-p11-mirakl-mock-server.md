# Story 3.2: Endpoint Wrappers — A01, PC01, OF21, P11 + Mirakl Mock Server

Endpoints verified against Mirakl MCP and architecture-distillate empirical facts (2026-05-06).

**Sprint-status key:** `3-2-endpoint-wrappers-a01-pc01-of21-p11-mirakl-mock-server`
**Status:** ready-for-dev
**Size:** L
**Epic:** Epic 3 — Mirakl Integration Foundation (architecture S-I phase 3)

---

## Narrative

**As a** BAD subagent implementing any story that calls Mirakl (Stories 3.3, 4.4, 7.2, 7.8),
**I want** typed, tested endpoint wrappers for A01, PC01, OF21, and P11 — plus a Fastify mock server that replays live Worten fixture data — backed by the `shared/mirakl/self-filter.js` competitor-offer filter chain,
**So that** every story in Epics 4–7 can call Mirakl endpoints through a safe, retried, redaction-tested path with a local mock that never hits production.

---

## Trace

- **Architecture decisions:** AD5 (api-client SSoT), AD13 (self-filter by shop_name), AD14 (mandatory active + total_price > 0 filters), AD16 partial (onboarding scan sequence: A01 → PC01 → OF21 → P11)
- **Functional requirements:** Foundation for FR8-FR15 (onboarding scan), FR20 (P11 ranking), FR23 (engine reads)
- **Non-functional requirements:** NFR-I1 (Mirakl reliability — covered by api-client retry, tested via mock server failure injection)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/01-epics-1-3-foundation-tenancy-mirakl.md`, Story 3.2
- **Architecture patterns:** `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md` — SSoT modules + test patterns
- **Architecture decisions detail:** `_bmad-output/planning-artifacts/architecture-distillate/02-decisions-A-D.md` — AD5, AD13, AD14

---

## MCP Verification Notes (Critical — Read Before Implementing)

### PC01 — Response Shape Is Nested Under `features.*`

**MCP-confirmed endpoint:** `GET /api/platform/configuration`

The live Mirakl PC01 response nests all settings under `features.*`. The fields the repricing engine needs are at:

| Spec name (flat) | Actual MCP path (nested) |
|---|---|
| `channel_pricing` | `features.pricing.channel_pricing` |
| `operator_csv_delimiter` | `features.operator_csv_delimiter` |
| `offer_prices_decimals` | `features.offer_prices_decimals` (string, not integer) |
| `discount_period_required` | `features.pricing.discount_period_required` |
| `scheduled_pricing` | `features.pricing.scheduled_pricing` |
| `volume_pricing` | `features.pricing.volume_pricing` |
| `competitive_pricing_tool` | `features.competitive_pricing_tool` |
| `order_tax_mode` | `features.order_tax_mode` |
| `multi_currency` | `features.multi_currency` |

**`getPlatformConfiguration` must normalize the nested response to a flat shape** that matches the spec in AC2 (and what the mock server returns). The mock server fixture (`FIXTURE_PC01` in `tests/mocks/mirakl-server.js`) already uses the flat shape — the wrapper must normalize the live response to match.

Implementation pattern:
```js
export async function getPlatformConfiguration (baseUrl, apiKey) {
  const raw = await mirAklGet(baseUrl, '/api/platform/configuration', null, apiKey);
  const f = raw.features;
  return {
    channel_pricing:            f.pricing.channel_pricing,
    operator_csv_delimiter:     f.operator_csv_delimiter,
    offer_prices_decimals:      Number(f.offer_prices_decimals),  // MCP returns string
    discount_period_required:   f.pricing.discount_period_required,
    scheduled_pricing:          f.pricing.scheduled_pricing,
    volume_pricing:             f.pricing.volume_pricing,
    competitive_pricing_tool:   f.competitive_pricing_tool,
    order_tax_mode:             f.order_tax_mode,
    multi_currency:             f.multi_currency,
    // Preserve entire raw response for JSONB snapshot
    _raw: raw,
  };
}
```

The full raw response must also be accessible for `customer_marketplaces.platform_features_snapshot` JSONB storage (AC2). Use `_raw` as the snapshot value, or return `{ ...normalized, _raw: raw }`. Callers that write to DB use `_raw`; engine callers read the flat fields.

### A01 — Confirmed, No Drift

MCP: `GET /api/account` → returns `shop_id`, `shop_name`, `currency_iso_code`, `is_professional`, `channels[]`, `domains[]`. No drift from spec.

Important: `shop_state` is NOT a field in the MCP Seller API A01 response spec. The mock fixture and architecture-distillate reference `shop_state: 'OPEN'` (from empirical Easy-Store capture). The `getAccount` wrapper should pass through whatever the API returns (including `shop_state` if present) rather than enforcing its presence. The AC1 typedef should mark `shop_state` as optional.

### OF21 — Confirmed, Offset Pagination

MCP: `GET /api/offers` → `offers[]` + `total_count`. Pagination via `offset` query param. No `pageToken` — spec AC3 says "pageToken" but the real OF21 uses offset-based pagination. The `getOffers` / `getAllOffers` implementation should use `offset` (integer) not a token string.

### P11 — Confirmed, No Drift

MCP: `GET /api/products/offers` → `products[].offers[]`. Use `product_references=EAN|<ean>` (not `product_ids`). Up to 100 values per call. `channel_codes` and `pricing_channel_code` are the correct parameter names. No drift.

---

## Dependencies

- **Story 3.1** (DONE): `shared/mirakl/api-client.js` exports `mirAklGet`, `MiraklApiError`; `shared/mirakl/safe-error.js` exports `getSafeErrorMessage`; `eslint-rules/no-direct-fetch.js` active

**Enables:**
- Story 3.3 (`mirakl-empirical-verify.js`) — smoke script calls all four wrappers
- Story 4.4 (catalog scan) — calls A01, PC01, OF21, P11 via these wrappers
- Story 7.2 (engine decide.js STEP 1) — calls P11 via `p11.js` + `self-filter.js`
- Story 7.8 (integration gate) — uses mock server and all 17 P11 fixtures

---

## SSoT Modules Introduced

This story establishes 5 of the 11 architecture-mandated SSoT modules:

1. **`shared/mirakl/a01.js`** — `getAccount(baseUrl, apiKey)` → `AccountInfo`
2. **`shared/mirakl/pc01.js`** — `getPlatformConfiguration(baseUrl, apiKey)` → flat-normalized PC01 shape
3. **`shared/mirakl/of21.js`** — `getOffers(baseUrl, apiKey, opts)` + `getAllOffers(baseUrl, apiKey)`
4. **`shared/mirakl/p11.js`** — `getProductOffersByEan(...)` + `getProductOffersByEanBatch(...)`
5. **`shared/mirakl/self-filter.js`** — `filterCompetitorOffers(rawOffers, ownShopName)` → `{filteredOffers, collisionDetected}`

All five must import from `shared/mirakl/api-client.js` — no direct `fetch()` call (ESLint `no-direct-fetch` will catch violations).

---

## Critical Constraints (Do Not Violate)

1. **No direct `fetch()` in any wrapper.** All four wrappers (`a01.js`, `pc01.js`, `of21.js`, `p11.js`) must import and call `mirAklGet` from `api-client.js`. The ESLint `no-direct-fetch` rule is already active (Story 3.1). The test file verifies this via source-code string inspection (`src.includes('fetch(')` assertions).

2. **No `export default`.** Named exports only. ESLint enforces `ExportDefaultDeclaration` ban.

3. **No `.then()` chains.** async/await only.

4. **No `console.log`.** pino only — but wrappers don't own a logger; they throw errors for callers to log.

5. **JSDoc `@param`, `@returns`, `@throws` on all exported functions.** Plus `@typedef` for `AccountInfo` (AC1).

6. **PC01 must normalize the nested `features.*` response to a flat shape** before returning. The mock server already returns the flat shape. The wrapper makes the live API look like the mock for callers.

7. **OF21 pagination uses `offset` (integer), not a cursor token.** `getOffers` accepts `{ offset?, pageSize? }` and returns `{ offers, nextOffset }` (or `{ offers, pageToken }` where `pageToken` = next offset as integer, null if exhausted). `getAllOffers` drives the loop internally.

8. **P11 must accept both single-EAN and batch-EAN signatures.** `getProductOffersByEan` is the per-SKU engine call; `getProductOffersByEanBatch` accepts up to 100 EANs concatenated as `EAN|x,EAN|y,...`.

9. **P11 returns raw offers — no filtering.** The `self-filter.js` module applies the AD13 + AD14 filter chain. The P11 wrapper returns `products[].offers` as received from the API.

10. **`filterCompetitorOffers` must implement the exact AD13+AD14 filter chain in this order:**
    ```
    .filter(o => o.active === true)
    .filter(o => Number.isFinite(o.total_price) && o.total_price > 0)
    .filter(o => o.shop_name !== ownShopName)
    .sort((a, b) => a.total_price - b.total_price)
    ```
    Returns `{ filteredOffers, collisionDetected }` where `collisionDetected = rawOffers.filter(o => o.shop_name === ownShopName).length > 1`.

11. **Mock server must NOT be modified to match broken expectations.** The mock server scaffold (`tests/mocks/mirakl-server.js`) is already complete and correct. Implement the source files to satisfy the tests — do not change test intent or mock server behavior.

12. **Test files are pre-existing scaffolds — do NOT recreate them.** Both test files already exist and are committed:
    - `tests/shared/mirakl/a01-pc01-of21-p11.test.js` — 25+ tests
    - `tests/shared/mirakl/self-filter.test.js` — 20+ tests

---

## File-Touch List

### New files

| File | Purpose |
|------|---------|
| `shared/mirakl/a01.js` | `getAccount` wrapper — A01 SSoT |
| `shared/mirakl/pc01.js` | `getPlatformConfiguration` wrapper — PC01 SSoT, normalizes `features.*` |
| `shared/mirakl/of21.js` | `getOffers` + `getAllOffers` — OF21 SSoT, offset pagination |
| `shared/mirakl/p11.js` | `getProductOffersByEan` + `getProductOffersByEanBatch` — P11 SSoT |
| `shared/mirakl/self-filter.js` | `filterCompetitorOffers` — AD13+AD14 filter chain SSoT |

### Pre-existing (do not recreate)

| File | Status |
|------|--------|
| `tests/mocks/mirakl-server.js` | ALREADY EXISTS — complete Fastify mock server with fixtures, failure injection, capture API |
| `tests/shared/mirakl/a01-pc01-of21-p11.test.js` | ALREADY EXISTS — all test cases written |
| `tests/shared/mirakl/self-filter.test.js` | ALREADY EXISTS — all test cases written |
| `tests/fixtures/a01/easy-store-2026-04-30.json` | ALREADY EXISTS |
| `tests/fixtures/pc01/worten-2026-04-30.json` | ALREADY EXISTS |
| `tests/fixtures/of21/easy-store-test-sku-2026-04-30.json` | ALREADY EXISTS |

---

## Acceptance Criteria

### AC1 — `getAccount` shape and JSDoc typedef

**Given** `shared/mirakl/a01.js` exports `getAccount(baseUrl, apiKey)`
**When** called against the mock server returning `FIXTURE_A01`
**Then:**
- Returns object conforming to `@typedef AccountInfo` with: `shop_id` (number), `shop_name` (string), `shop_state` (string, optional — pass-through), `currency_iso_code` (string), `is_professional` (boolean), `channels` (array), `domains` (array)
- Values match fixture: `shop_id === 19706`, `shop_name === 'Easy - Store'`, `currency_iso_code === 'EUR'`, `shop_state === 'OPEN'`
- File does NOT contain `fetch(` — uses `mirAklGet`

### AC2 — `getPlatformConfiguration` normalization and JSONB preservation

**Given** `shared/mirakl/pc01.js` exports `getPlatformConfiguration(baseUrl, apiKey)`
**When** called against the mock server
**Then:**
- Returns **flat** object with: `channel_pricing`, `operator_csv_delimiter`, `offer_prices_decimals` (number), `discount_period_required` (boolean), `competitive_pricing_tool` (boolean), `scheduled_pricing` (boolean), `volume_pricing` (boolean), `multi_currency` (boolean), `order_tax_mode` (string)
- Worten empirical values confirmed: `channel_pricing === 'SINGLE'`, `operator_csv_delimiter === 'SEMICOLON'`, `offer_prices_decimals === 2`, `discount_period_required === false`
- The returned object is JSON-serializable (round-trips `JSON.parse(JSON.stringify(result))` with `deepEqual`)
- **Note:** The mock server returns the flat shape directly; against live Mirakl, the wrapper must normalize from `features.*` — both paths must produce the same flat output

### AC3 — `getOffers` shape and `getAllOffers` pagination

**Given** `shared/mirakl/of21.js` exports `getOffers(baseUrl, apiKey, { offset?, pageSize? })` and `getAllOffers(baseUrl, apiKey)`
**When** `getOffers` is called:
- Returns `{ offers: [...], pageToken }` where `offers` is array and each offer has `{ shop_sku, product_sku, price, total_price, min_shipping_price, quantity, active, channels, product_references }`
- At least 1 offer exists; at least one has `shop_sku` populated
- File does NOT contain `fetch(` — uses `mirAklGet`

**When** `getAllOffers` is called:
- Drives pagination until exhausted; returns flat array of all offers across all pages
- Total count `>= firstPage.length`

### AC4 — `getProductOffersByEan` and `getProductOffersByEanBatch` P11 params

**Given** `shared/mirakl/p11.js` exports both functions
**When** `getProductOffersByEan(baseUrl, apiKey, { ean, channel, pricingChannelCode })` is called:
- Issues `GET /api/products/offers` with `product_references=EAN|<ean>`, `channel_codes=<channel>`, `pricing_channel_code=<channel>`
- Returns raw offer array (extracted from `products[0].offers` or equivalent)

**When** `getProductOffersByEanBatch(baseUrl, apiKey, { eans, channel })` is called with up to 100 EANs:
- Concatenates as `EAN|x,EAN|y,...` in `product_references`
- Does not throw for 100-EAN input
- File does NOT contain `fetch(` — uses `mirAklGet`

### AC5 — Mock server: fixture replay, 404 fallback, failure injection

**Given** `tests/mocks/mirakl-server.js` exports `createMiraklMockServer()`
**When** started:
- Returns `{ mockServer, baseUrl }` where `baseUrl` starts with `http://127.0.0.1:`
- `mockServer.close()` shuts down the server
- Unknown paths return 404 with JSON error body
- `mockServer.injectError({ path, status, count })` causes the next N requests to that path to return the injected status, then recovers to fixture
- `mockServer.captureNextRequest(path, callback)` fires callback once with parsed query params of the next request

**Note:** The mock server scaffold is already complete and committed — no implementation needed here.

### AC6 — Unit tests pass against mock server

**Given** `tests/shared/mirakl/a01-pc01-of21-p11.test.js` (already written)
**When** `node --test tests/shared/mirakl/a01-pc01-of21-p11.test.js` runs
**Then** all tests pass:
- Mock server baseline (starts, 404 fallback, failure injection recovery) ✓
- `getAccount` shape + Easy-Store empirical values ✓
- `getAccount` source does not call `fetch()` ✓
- `getPlatformConfiguration` required fields + Worten empirical values ✓
- `getPlatformConfiguration` JSON round-trip ✓
- `getOffers` shape + `shop_sku` populated ✓
- `getAllOffers` pagination exhaustion ✓
- `getOffers` source does not call `fetch()` ✓
- `getProductOffersByEan` query params captured ✓
- `getProductOffersByEanBatch` EAN concatenation ✓
- `getProductOffersByEanBatch` accepts 100 EANs ✓
- `getProductOffersByEan` returns raw offer array ✓
- `p11.js` source does not call `fetch()` ✓
- `self-filter` tests (in-file AC7 tests): all filter chain assertions ✓
- ESLint codebase scan: no `fetch(` outside `shared/mirakl/` ✓

### AC7 — `filterCompetitorOffers` filter chain and collision detection

**Given** `shared/mirakl/self-filter.js` exports `filterCompetitorOffers(rawOffers, ownShopName)`
**When** called:
- Applies filter chain in order: `active === true` → `Number.isFinite(total_price) && total_price > 0` → `shop_name !== ownShopName` → `.sort((a,b) => a.total_price - b.total_price)` ascending
- Returns `{ filteredOffers: [...], collisionDetected: boolean }`
- `collisionDetected = true` when **more than one** raw offer has `shop_name === ownShopName` (collision check runs on raw input, before filtering)
- Empty input → `{ filteredOffers: [], collisionDetected: false }`
- Post-filter empty → returns empty array (caller handles Tier 3)
- All 12+ scenarios in `tests/shared/mirakl/self-filter.test.js` pass

---

## Implementation Guide

### `shared/mirakl/a01.js`

```js
import { mirAklGet } from './api-client.js';

/**
 * @typedef {Object} AccountInfo
 * @property {number} shop_id
 * @property {string} shop_name
 * @property {string} [shop_state]
 * @property {string} currency_iso_code
 * @property {boolean} is_professional
 * @property {Array<{code: string, label: string}>} channels
 * @property {string[]} domains
 */

/**
 * A01 — Get shop information.
 * @param {string} baseUrl
 * @param {string} apiKey
 * @returns {Promise<AccountInfo>}
 * @throws {import('./api-client.js').MiraklApiError}
 */
export async function getAccount (baseUrl, apiKey) {
  return mirAklGet(baseUrl, '/api/account', null, apiKey);
}
```

The mock returns the fixture shape directly. Live A01 returns all the same fields. No normalization needed.

### `shared/mirakl/pc01.js`

Critical: live Mirakl PC01 response nests under `features.*`. The mock already returns the flat shape. The wrapper must handle both (or just normalize — the mock's flat response won't have a `features` key, so check before normalizing):

```js
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
 * @property {object} _raw - full API response for JSONB snapshot
 */

/**
 * PC01 — List platform configurations.
 * Normalizes the nested features.* response to a flat shape.
 * @param {string} baseUrl
 * @param {string} apiKey
 * @returns {Promise<PlatformConfiguration>}
 * @throws {import('./api-client.js').MiraklApiError}
 */
export async function getPlatformConfiguration (baseUrl, apiKey) {
  const raw = await mirAklGet(baseUrl, '/api/platform/configuration', null, apiKey);
  // Live Mirakl response: nested under features.*
  // Mock server response: already flat (for test compatibility)
  const f = raw.features;
  if (!f) {
    // Mock server returns flat shape directly — pass through with _raw
    return { ...raw, _raw: raw };
  }
  return {
    channel_pricing:          f.pricing.channel_pricing,
    operator_csv_delimiter:   f.operator_csv_delimiter,
    offer_prices_decimals:    Number(f.offer_prices_decimals),
    discount_period_required: f.pricing.discount_period_required,
    scheduled_pricing:        f.pricing.scheduled_pricing,
    volume_pricing:           f.pricing.volume_pricing,
    competitive_pricing_tool: f.competitive_pricing_tool,
    order_tax_mode:           f.order_tax_mode,
    multi_currency:           f.multi_currency,
    _raw: raw,
  };
}
```

### `shared/mirakl/of21.js`

OF21 uses offset pagination (MCP-confirmed). The mock server paginates on `req.query.offset`:

```js
import { mirAklGet } from './api-client.js';

/**
 * Get one page of own offers.
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {{ offset?: number, pageSize?: number }} opts
 * @returns {Promise<{ offers: object[], pageToken: number|null }>}
 * @throws {import('./api-client.js').MiraklApiError}
 */
export async function getOffers (baseUrl, apiKey, { offset = 0, pageSize = 100 } = {}) {
  const params = { offset, max: pageSize };
  const res = await mirAklGet(baseUrl, '/api/offers', params, apiKey);
  const offers = res.offers ?? [];
  const total = res.total_count ?? 0;
  const nextOffset = offset + offers.length < total ? offset + offers.length : null;
  return { offers, pageToken: nextOffset };
}

/**
 * Iterate all pages of own offers until exhausted.
 * @param {string} baseUrl
 * @param {string} apiKey
 * @returns {Promise<object[]>}
 * @throws {import('./api-client.js').MiraklApiError}
 */
export async function getAllOffers (baseUrl, apiKey) {
  const all = [];
  let offset = 0;
  for (;;) {
    const { offers, pageToken } = await getOffers(baseUrl, apiKey, { offset });
    all.push(...offers);
    if (pageToken === null) break;
    offset = pageToken;
  }
  return all;
}
```

### `shared/mirakl/p11.js`

```js
import { mirAklGet } from './api-client.js';

/**
 * P11 — single EAN + channel lookup.
 * Returns raw offer array (filtering done by self-filter.js).
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {{ ean: string, channel: string, pricingChannelCode: string }} opts
 * @returns {Promise<object[]>} raw offers array
 * @throws {import('./api-client.js').MiraklApiError}
 */
export async function getProductOffersByEan (baseUrl, apiKey, { ean, channel, pricingChannelCode }) {
  const params = {
    product_references: `EAN|${ean}`,
    channel_codes: channel,
    pricing_channel_code: pricingChannelCode,
  };
  const res = await mirAklGet(baseUrl, '/api/products/offers', params, apiKey);
  return res.products?.[0]?.offers ?? [];
}

/**
 * P11 — batch EAN lookup (up to 100 EANs per call).
 * Returns flat array of all offers across all returned products.
 * @param {string} baseUrl
 * @param {string} apiKey
 * @param {{ eans: string[], channel: string }} opts
 * @returns {Promise<object[]>}
 * @throws {import('./api-client.js').MiraklApiError}
 */
export async function getProductOffersByEanBatch (baseUrl, apiKey, { eans, channel }) {
  const productRefs = eans.map(e => `EAN|${e}`).join(',');
  const params = {
    product_references: productRefs,
    channel_codes: channel,
    pricing_channel_code: channel,
  };
  const res = await mirAklGet(baseUrl, '/api/products/offers', params, apiKey);
  return (res.products ?? []).flatMap(p => p.offers ?? []);
}
```

### `shared/mirakl/self-filter.js`

Implements the AD13 + AD14 filter chain exactly. Collision check runs on the raw offers BEFORE filtering:

```js
/**
 * @typedef {Object} FilterResult
 * @property {object[]} filteredOffers - Sorted ascending by total_price; own-shop, inactive, zero/non-finite price removed
 * @property {boolean} collisionDetected - True if >1 raw offer matched ownShopName (AD13 defensive)
 */

/**
 * Apply the AD13 + AD14 competitor-offer filter chain.
 * Filter order: active===true → total_price>0 && isFinite → shop_name!==own → sort ascending.
 * Collision check: >1 offer in raw list with shop_name===ownShopName (checked on raw input).
 *
 * @param {object[]} rawOffers - Unfiltered P11 offer list
 * @param {string} ownShopName - customer_marketplace.shop_name from A01 (e.g. 'Easy - Store')
 * @returns {FilterResult}
 */
export function filterCompetitorOffers (rawOffers, ownShopName) {
  const collisionDetected = rawOffers.filter(o => o.shop_name === ownShopName).length > 1;

  const filteredOffers = rawOffers
    .filter(o => o.active === true)
    .filter(o => Number.isFinite(o.total_price) && o.total_price > 0)
    .filter(o => o.shop_name !== ownShopName)
    .sort((a, b) => a.total_price - b.total_price);

  return { filteredOffers, collisionDetected };
}
```

---

## Pattern Compliance Checklist

Before marking done:

- [ ] `shared/mirakl/a01.js` — no `export default`, no `fetch(`, no `console.log`, async/await only, JSDoc on exports
- [ ] `shared/mirakl/pc01.js` — same + normalizes `features.*` when present, preserves `_raw` for JSONB
- [ ] `shared/mirakl/of21.js` — offset-based pagination (not cursor), `getAllOffers` drives loop
- [ ] `shared/mirakl/p11.js` — `product_references=EAN|<ean>` format, batch accepts up to 100, returns raw offers
- [ ] `shared/mirakl/self-filter.js` — filter chain in correct order, collision check on raw input, named export only
- [ ] All five files pass `node --test tests/shared/mirakl/a01-pc01-of21-p11.test.js`
- [ ] All test cases pass `node --test tests/shared/mirakl/self-filter.test.js`
- [ ] ESLint passes with 0 errors on new files (`npx eslint shared/mirakl/a01.js pc01.js of21.js p11.js self-filter.js`)

---

## Previous Story Intelligence (Story 3.1)

Story 3.1 (DONE) established:
- `api-client.js` exports `mirAklGet(baseUrl, path, params, apiKey)` and `MiraklApiError`
- `safe-error.js` exports `getSafeErrorMessage(err)` (re-exported from `api-client.js` for test compat)
- `no-direct-fetch` ESLint rule active on `app/**`, `worker/**`, `shared/**` (NOT `tests/**`)
- Key decisions from 3.1 review: `catch {}` (no binding) preferred for unused bindings; ESLint plugin registration uses `{ rules: { 'no-direct-fetch': noDirectFetch } }` wrapper shape

**Do NOT use** `getSafeErrorMessage` in the wrapper files — the wrappers propagate `MiraklApiError` unchanged for callers to handle. Only the api-client itself uses `getSafeErrorMessage` at throw time.

---

## Source Reference: DynamicPriceIdea

Existing production code at `D:\Plannae Project\DynamicPriceIdea\src\workers\mirakl\` contains:
- `scanCompetitors.js` — production P11 call pattern confirming `product_references=EAN|<ean>` + `channel_codes` + `pricing_channel_code`
- `apiClient.js` — already ported as Story 3.1

Check DynamicPriceIdea before writing any Mirakl call from scratch — the patterns are production-tested.

---

## Story Completion Status

Status: **ready-for-dev**
