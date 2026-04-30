#!/usr/bin/env node
// scripts/mirakl-empirical-verify.js
//
// READ-ONLY empirical verification of Mirakl Marketplace Platform (MMP)
// behavior against a real seller's shop API key on Worten.
//
// Two purposes:
//   1. One-time architecture verification (Pedro / 2026-04-30): grounds the
//      architecture spec in Worten's actual operator configuration before
//      decisions lock.
//   2. First-customer onboarding smoke test (Bob's Story 1.X — to be sharded):
//      same script, run against a new customer's shop_api_key after key
//      validation, asserts their Worten configuration matches expectations
//      (channel_pricing = MULTI, etc.). Fail-loudly if mismatched.
//
// SAFETY (these are the contract — do not relax):
//   * GET-only. No POST/PUT/PATCH/DELETE allowed, ever.
//     The runtime allowlist below enforces this; an attempted non-GET aborts.
//   * Allowlisted endpoint paths only. Any other path attempt aborts.
//   * Authorization header value is NEVER printed, logged, or echoed.
//     Errors print only HTTP status + safe English message.
//   * Output is structured JSON to stdout. Caller decides what to do with it
//     (paste, redirect to file, discard). The script does not write to disk.
//   * Reads credentials from environment variables. Never accepts them as
//     command-line arguments (would leak via shell history / process listing).
//   * One-shot. Exits after the run. No daemon, no retry storm.
//
// Required environment variables (from .env.local):
//   WORTEN_SHOP_API_KEY    Worten Mirakl shop API key (raw key — sent as
//                          `Authorization: <key>` header per Worten convention,
//                          no Bearer prefix).
//   WORTEN_INSTANCE_URL    Marketplace instance URL, e.g.
//                          https://marketplace.worten.pt
//   WORTEN_TEST_EAN        A 13-digit EAN from the seller's own catalog.
//                          Used for the P11 verification calls.
//
// Usage (loads .env.local automatically via Node ≥22 --env-file flag):
//   $ node --env-file=.env.local scripts/mirakl-empirical-verify.js > verification-results.json
//
// Node ≥22 required (built-in `fetch`, `performance.now`, `--env-file`).

'use strict'

// ---------------------------------------------------------------------------
// Constants — explicit allowlist of (method, path) combinations
// ---------------------------------------------------------------------------

/**
 * The only HTTP method allowed by this script. Any attempt to call with a
 * different method aborts the entire run.
 */
const ALLOWED_METHOD = 'GET'

/**
 * Paths this script is allowed to query. Anything else aborts.
 * Listed as templates; query params are appended at call time.
 */
const ALLOWED_PATHS = new Set([
  '/api/account',                  // A01 — shop info
  '/api/platform/configuration',   // PC01 — operator features
  '/api/offers',                   // OF21 — own offers
  '/api/products/offers',          // P11 — competitor offers per product
])

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

function requireEnv (name) {
  const v = process.env[name]
  if (typeof v !== 'string' || v.length === 0) {
    process.stderr.write(`ERROR: required env var ${name} is missing or empty.\n`)
    process.exit(1)
  }
  return v
}

const API_KEY = requireEnv('WORTEN_SHOP_API_KEY')
const BASE_URL = requireEnv('WORTEN_INSTANCE_URL').replace(/\/+$/, '')
const TEST_EAN = requireEnv('WORTEN_TEST_EAN')

if (!/^https:\/\//.test(BASE_URL)) {
  process.stderr.write('ERROR: WORTEN_INSTANCE_URL must start with https://\n')
  process.exit(1)
}
if (!/^\d{8,14}$/.test(TEST_EAN)) {
  process.stderr.write('ERROR: WORTEN_TEST_EAN must be 8–14 digits.\n')
  process.exit(1)
}

const TEST_SKU = `EZ${TEST_EAN}` // Convention: SKU = 'EZ' + EAN

// ---------------------------------------------------------------------------
// Safe HTTP wrapper — enforces allowlist and never echoes the key
// ---------------------------------------------------------------------------

/**
 * Make a single GET request to the Mirakl Marketplace API and return a
 * structured result. Never throws; errors are returned as `{ error }` blocks
 * with safe text only (status code + endpoint name).
 *
 * @param {string} path - one of ALLOWED_PATHS
 * @param {Record<string, string>} [params] - query parameters
 * @returns {Promise<object>} structured result
 */
async function safeGet (path, params) {
  // Allowlist enforcement — abort the entire run on violation
  if (ALLOWED_METHOD !== 'GET') {
    process.stderr.write('FATAL: non-GET method attempted. Aborting.\n')
    process.exit(2)
  }
  if (!ALLOWED_PATHS.has(path)) {
    process.stderr.write(`FATAL: path "${path}" not in allowlist. Aborting.\n`)
    process.exit(2)
  }

  const url = new URL(BASE_URL + path)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v))
    }
  }

  const startedAt = performance.now()
  let res
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: API_KEY },
    })
  } catch (err) {
    return {
      ok: false,
      status: 0,
      latency_ms: Math.round(performance.now() - startedAt),
      error: { kind: 'transport', message: err && err.code ? err.code : 'network_error' },
    }
  }

  const latency = Math.round(performance.now() - startedAt)
  const status = res.status

  let body = null
  try {
    body = await res.json()
  } catch (_) {
    body = null // non-JSON or empty
  }

  if (!res.ok) {
    return {
      ok: false,
      status,
      latency_ms: latency,
      error: { kind: 'http', message: `HTTP ${status}` },
      // No body included on failure to avoid surfacing operator-side
      // diagnostics that might echo headers we redact above.
    }
  }

  return { ok: true, status, latency_ms: latency, body }
}

// ---------------------------------------------------------------------------
// Verification calls (read-only)
// ---------------------------------------------------------------------------

async function callA01 () {
  return safeGet('/api/account')
}

async function callPC01 () {
  return safeGet('/api/platform/configuration')
}

async function callOF21One () {
  // sku filter narrows to exactly one offer — safer than ?max=1 enumeration
  return safeGet('/api/offers', { sku: TEST_SKU })
}

async function callP11PerChannel (channel) {
  return safeGet('/api/products/offers', {
    product_references: `EAN|${TEST_EAN}`,
    channel_codes: channel,
    pricing_channel_code: channel,
  })
}

async function callP11AllChannels () {
  return safeGet('/api/products/offers', {
    product_references: `EAN|${TEST_EAN}`,
    all_channels: 'true',
  })
}

// ---------------------------------------------------------------------------
// Summary computations — extract the architectural decision points
// ---------------------------------------------------------------------------

/**
 * Pull the load-bearing fields out of A01.
 * @param {object} body - A01 response body
 */
function summariseA01 (body) {
  if (!body) return null
  return {
    shop_id: body.shop_id ?? null,
    shop_name: body.shop_name ?? null,
    shop_state: body.shop_state ?? null,
    suspension_type: body.suspension_type ?? null,
    channels: body.channels ?? null,
    currency_iso_code: body.currency_iso_code ?? null,
    is_professional: body.is_professional ?? null,
    premium: body.premium ?? null,
    domains: body.domains ?? null,
  }
}

/**
 * Pull the load-bearing flags from PC01.
 * @param {object} body - PC01 response body
 */
function summarisePC01 (body) {
  if (!body || !body.features) return null
  const f = body.features
  return {
    channel_pricing: f.pricing?.channel_pricing ?? null,
    operator_csv_delimiter: f.operator_csv_delimiter ?? null,
    offer_prices_decimals: f.offer_prices_decimals ?? null,
    discount_period_required: f.pricing?.discount_period_required ?? null,
    competitive_pricing_tool: f.competitive_pricing_tool ?? null,
    multi_currency: f.multi_currency ?? null,
    scheduled_pricing: f.pricing?.scheduled_pricing ?? null,
    volume_pricing: f.pricing?.volume_pricing ?? null,
    order_tax_mode: f.order_tax_mode ?? null,
  }
}

/**
 * Inspect the OF21 response shape — confirm shipping field population.
 * @param {object} body - OF21 response body
 */
function summariseOF21 (body) {
  const offers = body && Array.isArray(body.offers) ? body.offers : []
  if (offers.length === 0) {
    return { found: false, reason: 'no_offer_for_sku' }
  }
  const o = offers[0]
  const allPrices = Array.isArray(o.all_prices) ? o.all_prices : []
  return {
    found: true,
    offer_id: o.offer_id ?? o.id ?? null,
    // Mirakl naming: `shop_sku` is the seller-provided SKU (used in PRI01
    // `offer-sku` column). `offer_sku` does not consistently appear; checking
    // both for diagnostic completeness. `product_sku` is Mirakl's internal
    // product UUID, NOT the seller's SKU.
    shop_sku: o.shop_sku ?? null,
    offer_sku: o.offer_sku ?? o.sku ?? null,
    product_sku: o.product_sku ?? null,
    active: o.active ?? null,
    inactivity_reasons: o.inactivity_reasons ?? null,
    channels: o.channels ?? null,
    quantity: o.quantity ?? null,
    price: o.price ?? null,
    total_price: o.total_price ?? null,
    currency_iso_code: o.currency_iso_code ?? null,
    min_shipping_price: o.min_shipping_price ?? null,
    min_shipping_price_additional: o.min_shipping_price_additional ?? null,
    min_shipping_type: o.min_shipping_type ?? null,
    min_shipping_zone: o.min_shipping_zone ?? null,
    shipping_types_count: Array.isArray(o.shipping_types) ? o.shipping_types.length : 0,
    shipping_types_first: Array.isArray(o.shipping_types) ? o.shipping_types[0] ?? null : null,
    all_prices_count: allPrices.length,
    all_prices_channel_codes: allPrices.map(p => p.channel_code ?? null),
    state_code: o.state_code ?? null,
    eco_contributions_count: Array.isArray(o.eco_contributions) ? o.eco_contributions.length : 0,
  }
}

/**
 * Summarise a per-channel P11 response and check whether OUR shop appears
 * in the ranked competitor list (Q15 self-identification verification).
 * @param {object} body - P11 response body
 * @param {string|null} ownShopName - shop_name from A01
 * @param {number|null} ownShopId - shop_id from A01
 */
function summariseP11 (body, ownShopName, ownShopId) {
  const products = body && Array.isArray(body.products) ? body.products : []
  if (products.length === 0) return { products: 0 }
  const p = products[0]
  const offers = Array.isArray(p.offers) ? p.offers : []
  const ranked = offers.map((o, idx) => ({
    rank: idx,
    shop_id: o.shop_id ?? null,
    shop_name: o.shop_name ?? null,
    shop_sku: o.shop_sku ?? null,
    active: o.active ?? null,
    total_price: o.total_price ?? null,
    price: o.price ?? null,
    state_code: o.state_code ?? null,
    all_prices_channel_codes: Array.isArray(o.all_prices)
      ? o.all_prices.map(ap => ap.channel_code ?? null)
      : null,
  }))
  // Self-identification check: does any returned offer match our shop?
  const selfMatchesByName = ownShopName
    ? ranked.filter(o => o.shop_name === ownShopName)
    : []
  const selfMatchesById = ownShopId
    ? ranked.filter(o => o.shop_id === ownShopId)
    : []
  return {
    products: products.length,
    product_sku: p.product_sku ?? null,
    product_title: p.product_title ?? null,
    product_references: p.product_references ?? null,
    total_count: p.total_count ?? null,
    offers_returned: offers.length,
    ranked_offers: ranked,
    self_filter: {
      own_shop_name: ownShopName,
      own_shop_id: ownShopId,
      self_offer_in_response_by_name: selfMatchesByName.length > 0,
      self_offer_in_response_by_id: selfMatchesById.length > 0,
      self_match_count_by_name: selfMatchesByName.length,
      self_match_count_by_id: selfMatchesById.length,
    },
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main () {
  const runStartedAt = new Date().toISOString()

  // 1. A01 — capture shop identity (must succeed; everything else depends on it)
  const a01 = await callA01()
  const a01Summary = a01.ok ? summariseA01(a01.body) : null

  // 2. PC01 — capture operator features
  const pc01 = await callPC01()
  const pc01Summary = pc01.ok ? summarisePC01(pc01.body) : null

  // 3. OF21 — capture one own offer for shape verification
  const of21 = await callOF21One()
  const of21Summary = of21.ok ? summariseOF21(of21.body) : null

  // 4. P11 per-channel PT
  const p11pt = await callP11PerChannel('WRT_PT_ONLINE')
  const p11ptSummary = p11pt.ok
    ? summariseP11(p11pt.body, a01Summary?.shop_name ?? null, a01Summary?.shop_id ?? null)
    : null

  // 4b. P11 per-channel ES
  const p11es = await callP11PerChannel('WRT_ES_ONLINE')
  const p11esSummary = p11es.ok
    ? summariseP11(p11es.body, a01Summary?.shop_name ?? null, a01Summary?.shop_id ?? null)
    : null

  // 5. P11 all_channels=true
  const p11all = await callP11AllChannels()
  const p11allSummary = p11all.ok
    ? summariseP11(p11all.body, a01Summary?.shop_name ?? null, a01Summary?.shop_id ?? null)
    : null

  const output = {
    verification_run: {
      timestamp: runStartedAt,
      base_url: BASE_URL,
      test_ean: TEST_EAN,
      test_sku: TEST_SKU,
      node_version: process.version,
      script_version: '2026-04-30',
    },
    raw_results: {
      a01: { ok: a01.ok, status: a01.status, latency_ms: a01.latency_ms, error: a01.error ?? null },
      pc01: { ok: pc01.ok, status: pc01.status, latency_ms: pc01.latency_ms, error: pc01.error ?? null },
      of21: { ok: of21.ok, status: of21.status, latency_ms: of21.latency_ms, error: of21.error ?? null },
      p11_pt: { ok: p11pt.ok, status: p11pt.status, latency_ms: p11pt.latency_ms, error: p11pt.error ?? null },
      p11_es: { ok: p11es.ok, status: p11es.status, latency_ms: p11es.latency_ms, error: p11es.error ?? null },
      p11_all_channels: { ok: p11all.ok, status: p11all.status, latency_ms: p11all.latency_ms, error: p11all.error ?? null },
    },
    summaries: {
      a01: a01Summary,
      pc01: pc01Summary,
      of21: of21Summary,
      p11_pt: p11ptSummary,
      p11_es: p11esSummary,
      p11_all_channels: p11allSummary,
    },
    architecture_assertions: {
      // Architectural prerequisites. Any false here for a paying customer = stop.
      // SINGLE or MULTI both support per-channel pricing (one price per channel
      // is what MarketPilot writes); only DISABLED forces schema collapse.
      channel_pricing_supports_per_channel:
        pc01Summary?.channel_pricing === 'SINGLE'
        || pc01Summary?.channel_pricing === 'MULTI',
      worten_channel_pricing_mode: pc01Summary?.channel_pricing ?? null,
      pc01_csv_delimiter_known: pc01Summary?.operator_csv_delimiter !== null,
      pc01_decimal_precision_known: pc01Summary?.offer_prices_decimals !== null,
      a01_shop_name_present: typeof a01Summary?.shop_name === 'string' && a01Summary.shop_name.length > 0,
      a01_shop_id_present: typeof a01Summary?.shop_id === 'number',
      of21_returned_test_offer: of21Summary?.found === true,
      of21_shipping_min_price_populated: of21Summary?.min_shipping_price !== null,
      p11_pt_returned_offers: (p11ptSummary?.offers_returned ?? 0) > 0,
      p11_es_returned_offers: (p11esSummary?.offers_returned ?? 0) > 0,
      // Q15: presence of self in P11 — "true" tells us we MUST filter; "false"
      // alone is inconclusive (self may be inactive on this channel/EAN). The
      // spec implements a defensive shop_name filter regardless.
      p11_pt_includes_self_by_name: p11ptSummary?.self_filter?.self_offer_in_response_by_name ?? false,
      p11_es_includes_self_by_name: p11esSummary?.self_filter?.self_offer_in_response_by_name ?? false,
    },
  }

  process.stdout.write(JSON.stringify(output, null, 2) + '\n')
}

main().catch(err => {
  // Catch-all — should not normally fire because safeGet swallows transport
  // errors. If it does, print a safe message only.
  process.stderr.write(`FATAL: unexpected error in main(): ${err && err.code ? err.code : 'unknown'}\n`)
  process.exit(3)
})
