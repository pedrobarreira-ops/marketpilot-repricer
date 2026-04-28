# MCP Forbidden Patterns — DynamicPriceIdea

Patterns that would cause silent production failures against the live Worten Mirakl instance. Verified via `scripts/mcp-probe.js` on 2026-04-18. If any of these appear in `src/workers/mirakl/*.js` or `src/workers/reportWorker.js`, it's a bug.

---

## Pattern 1 — `state === 'ACTIVE'` (or `state: 'ACTIVE'`)

**Symptom:** Worker filters catalog offers by `offer.state === 'ACTIVE'` to identify "active" offers.

**Why it's broken:** The `offer.state` field does not exist on OF21 responses (verified MISSING on live Worten). The field `offer.state_code` exists but represents offer *condition* (e.g. `"11"` for new), not active/inactive.

**Correct pattern:** `offer.active === true` (boolean field, required).

**Grep:**
```bash
grep -nE "state\s*===?\s*['\"]ACTIVE['\"]|state:\s*['\"]ACTIVE['\"]" src/workers/mirakl/
```

Live Worten probe result (OF21 GET /api/offers, first offer):
- `active`: boolean ✓
- `state`: MISSING
- `state_code`: "11" (a condition code, not active flag)

---

## Pattern 2 — `product_ids` with plain EANs

**Symptom:** P11 (competitor scan) call uses `product_ids: eans.join(',')`.

**Why it's broken:** Per Mirakl MCP, `product_ids` expects *product SKUs* (in Worten, UUIDs like `321b4d45-75eb-4c9d-9557-f164e9d62197`). Passing EANs silently returns 0 products (live-probed and confirmed).

**Correct pattern:** `product_references: eans.map(e => 'EAN|' + e).join(',')` — pipe-delimited type|value pairs.

**Grep:**
```bash
grep -nE "product_ids\s*:\s*.*eans" src/workers/mirakl/
```

Live probe results:
- P11 with `product_ids=<plain EANs>` → 0 products
- P11 with `product_references=EAN|xxx,EAN|yyy` → N products ✓
- P11 with `product_ids=<product_sku UUIDs>` → N products ✓ (but requires a separate lookup)

---

## Pattern 3 — `offer.channel_code` / `o.channel_code` (singular, on offer)

**Symptom:** Code filters competitor offers by `o.channel_code === 'WRT_PT_ONLINE'`.

**Why it's broken:** The `channel_code` singular field does NOT exist on P11 offers (verified MISSING on live response). The `offer.channels` array exists but is typically EMPTY `[]` on competitor offers. Filter evaluates to `false` every time → empty pt/es buckets in production.

**Correct pattern:** Make TWO P11 calls per batch, one per channel, each with `pricing_channel_code=<CHANNEL>` set. Bucket offers by *which call returned them* — do not read channel from the offer object.

**Grep:**
```bash
grep -nE "\b(o|offer)\.channel_code\s*===?" src/workers/mirakl/
```

Live probe result (P11 competitor offer keys):
- `channel_code`: MISSING
- `channels`: `[]` (empty array)
- `all_prices[].channel_code`: present (per-price channel, not per-offer)

---

## Pattern 4 — `offer.price` without `offer.total_price` alongside

**Symptom:** Competitor price comparison uses `offer.price` (price only, no shipping).

**Why it's broken:** `offer.price` is the bare price; it does NOT include shipping. In competitor comparison, a shop with low price + high shipping can *look* cheaper than the true total. Spec requires `total_price = price + minimum shipping rate`.

**Correct pattern:** Use `offer.total_price` for competitor comparison. Pair with `pricing_channel_code` so `total_price` reflects the channel-specific pricing.

**Grep (flag if `offer.price` is used in comparison contexts):**
```bash
grep -nE "\.price(\s|\)|\.)" src/workers/mirakl/scanCompetitors.js | grep -v total_price
```

This is context-dependent — the existence of `offer.price` is fine (it's a valid field); the concern is using it *instead of* `offer.total_price` in competitor scoring.

---

## Pattern 6 — Wrong Mirakl auth header name

**Symptom:** API client sets the wrong auth header — most commonly `X-Mirakl-Front-Api-Key` when the instance expects `Authorization`.

**Why it's broken:** Mirakl operators configure auth differently per deployment. Worten's instance uses `Authorization: <key>` (raw key, no `Bearer` prefix). Verified via MCP security schema (`securitySchemes.shop_api_key.name === "Authorization"`). Some other Mirakl operators use `X-Mirakl-Front-Api-Key` — but NOT Worten. Using the wrong header name → every request 401s in production while tests pass (because tests mock the fetch call and don't verify the actual header value against reality).

**Correct pattern for Worten:** `const headers = { Authorization: apiKey }` — raw key, no prefix.

**Grep:**
```bash
grep -nE "'X-Mirakl-Front-Api-Key'|\"X-Mirakl-Front-Api-Key\"" src/workers/mirakl/
```

Live probe evidence: `scripts/mcp-probe.js` and `scripts/scale_test.js` both use `Authorization: <key>` and succeed. When `apiClient.js` used `X-Mirakl-Front-Api-Key` instead (fixed 2026-04-19), the end-to-end integration test hit 401 in 5 seconds at Phase A. This is the textbook "ATDD keyword-grep passes + live integration fails" pattern — the ATDD test happened to assert the wrong header literal, so it locked the bug in place.

**Generalization:** when writing API-client code for any third-party service where the auth scheme is deployment-specific, **require a live probe before committing** — ATDD tests that assert a specific header value only verify you didn't have a typo, not that you picked the right scheme.

---

## Pattern 5 — Compare `activeOffers.length` to `total_count`

**Symptom:** Truncation check compares POST-active-filter count to the API's `total_count`:
```js
if (activeOffers.length !== total_count) throw new CatalogTruncationError(...)
```

**Why it's broken:** OF21's `total_count` counts ALL offers (active + inactive). Comparing to the post-filter active count will throw false `CatalogTruncationError` on any catalog with even one inactive offer.

**Correct pattern:** Compare PRE-filter `allOffers.length` to `total_count` (detects pagination truncation), THEN filter for active.

**Grep:**
```bash
grep -nE "activeOffers\.length\s*!==?\s*total_count|activeOffers\.length\s*!==?\s*totalCount" src/workers/mirakl/
```

Live probe confirms: OF21 has no server-side active filter param; active filtering is client-side only.

---

## Additional MCP-verified facts (from live probe 2026-04-18)

| Endpoint | Operation | Key facts |
|---|---|---|
| OF21 | `GET /api/offers` | offset pagination; `max=100`/page; `offer.active` boolean; `offer.product_references[].reference` for EAN; `offer.applicable_pricing.price` for seller's own price; root `total_count` counts all offers |
| P11 | `GET /api/products/offers` | `product_references=EAN\|xxx` batch param; `channel_codes` filters which offers come back; `pricing_channel_code` makes `applicable_pricing` + `total_price` channel-specific; `offer.active` boolean; `offer.total_price` = price + min shipping; `product.product_references[].reference` where `reference_type === 'EAN'` |
| PRI01 | `POST /api/offers/pricing/imports` | multipart/form-data with `file`; CSV semicolon-delimited: `"offer-sku";"price";"discount-price";"discount-start-date";"discount-end-date"`; max 50 prices/offer; returns `201 { import_id }`; max **once per minute**; **delete-and-replace** — any price not in CSV is DELETED |
| PRI02 | `GET /api/offers/pricing/imports` | `data[].status` enum: `WAITING\|RUNNING\|COMPLETE\|FAILED`; `has_error_report` boolean; max once/minute |
| PRI03 | `GET /api/offers/pricing/imports/{import_id}/error_report` | Returns CSV of errored rows; call only when `has_error_report: true` |

For any NEW endpoint not in this table, or any NEW field/param on a known endpoint: run `scripts/mcp-probe.js` (or extend it) before finalizing the story spec. Distillate pins catch syntax errors; only live probes catch semantic errors like Pattern 2 above.
