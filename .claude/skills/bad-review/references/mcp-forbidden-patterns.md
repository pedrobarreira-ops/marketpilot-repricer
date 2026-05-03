# MCP Forbidden Patterns — marketpilot-repricer

Patterns that would cause silent production failures against the live Worten Mirakl
instance, OR violate one of marketpilot-repricer's 27 architectural constraints, OR
break the migration-immutability invariant. Mirakl-side patterns verified via the
Mirakl MCP server (per CLAUDE.md — single source of truth). If any of these appear
in `shared/mirakl/`, `worker/src/engine/`, `worker/src/safety/`, `app/src/routes/`,
`shared/audit/`, `shared/state/`, `shared/money/`, or `supabase/migrations/`, it's
a bug — flag as BLOCKING in Subagent A's audit.

> **Pattern 1 (`state === 'ACTIVE'`) was REMOVED** — in marketpilot-repricer, the
> string literal `'ACTIVE'` is the canonical UPPER_SNAKE_CASE value of `cron_state`
> per F13 lock. The legacy DynamicPriceIdea pattern (filtering offers by `state ===
> 'ACTIVE'` against an OF21 response that lacks the field) does not apply — our
> Mirakl reads use `offer.active` (boolean) and our cron-state writes use the
> UPPER_SNAKE_CASE string. Searching for `state === 'ACTIVE'` here would create
> false positives on legitimate cron-state code.

---

## Pattern 2 — `product_ids` with plain EANs

**Symptom:** P11 (competitor scan) call uses `product_ids: eans.join(',')`.

**Why it's broken:** Per Mirakl MCP, `product_ids` expects *product SKUs* (in Worten, UUIDs like `321b4d45-75eb-4c9d-9557-f164e9d62197`). Passing EANs silently returns 0 products (live-probed and confirmed).

**Correct pattern:** `product_references: eans.map(e => 'EAN|' + e).join(',')` — pipe-delimited type|value pairs.

**Grep:**
```bash
grep -nE "product_ids\s*:\s*.*eans" shared/mirakl/ worker/src/engine/
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
grep -nE "\b(o|offer)\.channel_code\s*===?" shared/mirakl/ worker/src/engine/
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
grep -nE "\.price(\s|\)|\.)" worker/src/engine/scan-competitors.js | grep -v total_price
```

This is context-dependent — the existence of `offer.price` is fine (it's a valid field); the concern is using it *instead of* `offer.total_price` in competitor scoring.

---

## Pattern 6 — Wrong Mirakl auth header name

**Symptom:** API client sets the wrong auth header — most commonly `X-Mirakl-Front-Api-Key` when the instance expects `Authorization`, OR adds a `Bearer ` prefix to the key.

**Why it's broken:** Mirakl operators configure auth differently per deployment. Worten's instance uses `Authorization: <key>` (raw key, no `Bearer` prefix). Verified via MCP security schema (`securitySchemes.shop_api_key.name === "Authorization"`). Some other Mirakl operators use `X-Mirakl-Front-Api-Key` — but NOT Worten. Using the wrong header name → every request 401s in production while tests pass (because tests mock the fetch call and don't verify the actual header value against reality).

**Correct pattern for Worten:** `const headers = { Authorization: apiKey }` — raw key, no prefix.

**Grep:**
```bash
grep -nE "'X-Mirakl-Front-Api-Key'|\"X-Mirakl-Front-Api-Key\"|Bearer\s+\$\{?(api_?key|apiKey|shop_api_key)" shared/mirakl/
```

Live probe evidence (DynamicPriceIdea historical, applicable to Worten target):
`Authorization: <key>` succeeds; `X-Mirakl-Front-Api-Key` 401s in 5 seconds; a
`Bearer ` prefix also 401s. ATDD keyword-grep tests pass on the wrong literal,
so the bug locks in until live integration. Empirical fact #10 in
architecture-distillate confirms raw `Authorization: <key>` for Worten, no prefix.

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
grep -nE "activeOffers\.length\s*!==?\s*total_count|activeOffers\.length\s*!==?\s*totalCount" shared/mirakl/ worker/src/engine/
```

Live probe confirms: OF21 has no server-side active filter param; active filtering is client-side only.

---

## Pattern 7 — `OF24` used for price updates

**Symptom:** Code calls OF24 (`POST /api/offers`) to update an existing offer's price.

**Why it's broken:** OF24 resets every offer field not present in the payload back
to its default. A price-only OF24 wipes shipping, leadtime, condition, etc.
Constraint #6 in architecture-distillate locks this as a permanent footgun.

**Correct pattern:** PRI01 (`POST /api/offers/pricing/imports`) for ALL price-only
updates. Multipart CSV: `"offer-sku";"price";"discount-price";"discount-start-date";"discount-end-date"`.

**Grep:**
```bash
grep -rnE "/api/offers['\"\\s,)]|\bOF24\b|offers/import" shared/mirakl/ worker/src/engine/ \
  | grep -v "/api/offers/pricing/imports" \
  | grep -v "/api/offers/exports"
```

---

## Pattern 8 — `product_sku` used as seller SKU in PRI01 CSV

**Symptom:** PRI01 CSV builder writes the `product_sku` (Worten's UUID-like product
identifier) into the `offer-sku` column.

**Why it's broken:** PRI01's `offer-sku` column expects the SELLER's offer SKU
(`shop_sku` in the OF21 response — typically the seller's internal SKU). Using
`product_sku` either silently no-ops (no offer matches) or, worse, accidentally
matches the wrong shop's offer if SKUs collide. Empirical fact #12.

**Correct pattern:** map from `offer.shop_sku` (OF21) to the `offer-sku` column.

**Grep:**
```bash
grep -rnE "product_sku.*offer.sku|offer.sku.*product_sku" shared/mirakl/ worker/src/
# Also flag any PRI01 CSV builder using a field other than shop_sku
grep -rnE "offer-?sku.*=.*(?!shop_sku)" shared/mirakl/pri01* worker/src/engine/
```

---

## Pattern 9 — Float-price math outside `shared/money/index.js`

**Symptom:** Any arithmetic on price values (`price * 0.95`, `price + shipping`,
`Number(price).toFixed(2)`) outside the canonical money module.

**Why it's broken:** Float arithmetic on EUR amounts produces 0.1+0.2 = 0.30000000000000004
drift. Constraint #22 + AD8 STEP 3 lock all money math to `shared/money/index.js`,
which uses integer cents internally and exposes Decimal-safe operations.

**Correct pattern:** import from `shared/money/index.js` (`add`, `subtract`,
`multiplyByMargin`, `format`). Never multiply or add raw price floats.

**Grep:**
```bash
grep -rnE "\bprice\s*[\*\+\-]\s*[0-9.]|toFixed\s*\(\s*2\s*\)|parseFloat\s*\(.*price" \
  app/ worker/ shared/ \
  --exclude-dir=shared/money --exclude-dir=tests --exclude-dir=node_modules
```

---

## Pattern 10 — Raw `INSERT INTO audit_log` outside `shared/audit/writer.js`

**Symptom:** Any code outside the audit-writer SSoT inserts directly into `audit_log`.

**Why it's broken:** Constraint #21 — the audit writer enforces hierarchical
summarization, the 3-tier priority taxonomy (atenção/notável/rotina), and GDPR
Art 17 retention semantics. Bypassing it produces flat-chronological rows that
the dashboard cannot render and the deletion job cannot scope.

**Correct pattern:** `import { writeAudit } from 'shared/audit/writer.js'` and call
the typed entrypoint.

**Grep:**
```bash
grep -rnE "INSERT\s+INTO\s+audit_log|FROM\s+audit_log\s+INSERT" \
  app/ worker/ shared/ \
  --exclude-dir=shared/audit --exclude-dir=tests --exclude-dir=node_modules
```

---

## Pattern 11 — Direct `fetch(` for Mirakl outside `shared/mirakl/api-client.js`

**Symptom:** Any module imports `node-fetch` / uses global `fetch` to call a Mirakl
endpoint directly, bypassing the API-client SSoT.

**Why it's broken:** Constraint #19 — the Mirakl client owns auth header injection
(no Bearer prefix), retry/backoff, rate-limit handling (PRI01 max 1/min), and
request/response logging redaction. Direct `fetch(` ships requests without these
invariants — first symptom is silent 401s or rate-limit lockouts in production.

**Correct pattern:** `import { miraklRequest } from 'shared/mirakl/api-client.js'`.

**Grep:**
```bash
grep -rnE "fetch\s*\(\s*['\"\`].*\.mirakl|fetch\s*\(\s*['\"\`].*marketplace\.worten" \
  app/ worker/ shared/ \
  --exclude-dir=shared/mirakl --exclude-dir=tests --exclude-dir=node_modules
```

---

## Pattern 12 — Raw `UPDATE customer_marketplaces SET cron_state` outside `shared/state/cron-state.js`

**Symptom:** Any code mutates `customer_marketplaces.cron_state` via raw SQL
instead of going through the state-machine module.

**Why it's broken:** Constraint #23 — the cron-state module enforces valid
transitions (e.g. `RUNNING` → `IDLE` only after a successful tick; `ERROR` is
terminal until manual reset). Bypassing it produces illegal states that the
engine treats as "stuck running forever" or worse.

**Correct pattern:** `import { transitionCronState } from 'shared/state/cron-state.js'`
with the explicit from→to argument.

**Grep:**
```bash
grep -rnE "UPDATE\s+customer_marketplaces\s+SET\s+.*cron_state" \
  app/ worker/ shared/ supabase/ \
  --exclude-dir=shared/state --exclude-dir=tests --exclude-dir=node_modules
```

---

## Pattern 13 — Worker queries missing `customer_marketplace_id` filter

**Symptom:** A query in `worker/src/` reads or writes a customer-scoped table
(offers, audit_log, prices) without a `WHERE customer_marketplace_id = $1` filter
AND without a `// safe: cross-customer cron` comment justifying the omission.

**Why it's broken:** Constraint #24 — RLS does not protect worker code (it runs as
service_role). Missing the customer scope mixes data across tenants. The comment
exception covers legitimate cron sweeps that intentionally span all customers.

**Correct pattern:** every customer-scoped query gets `customer_marketplace_id = $1`,
OR an explicit `// safe: cross-customer cron` comment on the line directly above.

**Grep (manual review required — heuristic):**
```bash
grep -rnE "FROM\s+(offers|audit_log|prices|customer_marketplaces)" worker/src/ \
  | grep -v "customer_marketplace_id"
# Then verify each hit has a "safe: cross-customer cron" comment within 2 lines above.
```

---

## Pattern 14 — `apply_migration` via Supabase MCP

**Symptom:** Any code path or subagent transcript shows a call to the Supabase MCP
`apply_migration` tool against the project.

**Why it's broken:** Project rule (CLAUDE.md MCP rule) — migrations apply via
`npx supabase db push` only, so the local migration files and the remote
`schema_migrations` tracking table stay in lockstep. `apply_migration` via MCP
writes to the remote without leaving a local file, producing exactly the kind of
silent divergence that the immutability rule is designed to prevent.

**Correct pattern:** create a file in `supabase/migrations/<timestamp>_<slug>.sql`,
commit it, then run `npx supabase db push`.

**Grep (across recent transcripts and any tooling scripts):**
```bash
grep -rnE "supabase__apply_migration|apply_migration\(" scripts/ .claude/ _bmad-output/
```

---

## Pattern 15 — Modified migration in `supabase/migrations/`

**Symptom:** A PR's diff modifies (not adds) any `.sql` file in `supabase/migrations/`
that already exists in main's git history.

**Why it's broken:** Migrations are append-only after first commit. `npx supabase
db push` skips files already tracked in `supabase_migrations.schema_migrations`,
so local-file edits never reach the remote DB. Multi-environment setups diverge
silently — local dev regenerates with the edit, staging/prod still have the
original — and the bug surfaces as "doesn't reproduce locally" days later.

**Correct pattern:** create a NEW migration file with the schema delta. NEVER
touch an existing migration after first commit, including for typo fixes,
index additions, default-value changes, or comment edits.

**Grep (deterministic, run in Phase 1 step 9 of bad-review):**
```bash
git log --diff-filter=M --name-only HEAD -- 'supabase/migrations/*.sql' | sort -u
```

If any output: BLOCKING. Severity: HIGH (multi-day production-incident class).

---

## Additional MCP-verified facts (from live probe 2026-04-18)

| Endpoint | Operation | Key facts |
|---|---|---|
| OF21 | `GET /api/offers` | offset pagination; `max=100`/page; `offer.active` boolean; `offer.product_references[].reference` for EAN; `offer.applicable_pricing.price` for seller's own price; root `total_count` counts all offers |
| P11 | `GET /api/products/offers` | `product_references=EAN\|xxx` batch param; `channel_codes` filters which offers come back; `pricing_channel_code` makes `applicable_pricing` + `total_price` channel-specific; `offer.active` boolean; `offer.total_price` = price + min shipping; `product.product_references[].reference` where `reference_type === 'EAN'` |
| PRI01 | `POST /api/offers/pricing/imports` | multipart/form-data with `file`; CSV semicolon-delimited: `"offer-sku";"price";"discount-price";"discount-start-date";"discount-end-date"`; max 50 prices/offer; returns `201 { import_id }`; max **once per minute**; **delete-and-replace** — any price not in CSV is DELETED |
| PRI02 | `GET /api/offers/pricing/imports` | `data[].status` enum: `WAITING\|RUNNING\|COMPLETE\|FAILED`; `has_error_report` boolean; max once/minute |
| PRI03 | `GET /api/offers/pricing/imports/{import_id}/error_report` | Returns CSV of errored rows; call only when `has_error_report: true` |

For any NEW endpoint not in this table, or any NEW field/param on a known endpoint:
verify against the Mirakl MCP server first (per CLAUDE.md). Only live MCP queries
catch semantic errors like Pattern 2 above. Distillate pins catch syntax errors only.
The 16-row "Cross-Cutting Empirically-Verified Mirakl Facts" table in
`_bmad-output/planning-artifacts/architecture-distillate/_index.md` is the curated,
stable reference; the MCP server is the source of truth.
