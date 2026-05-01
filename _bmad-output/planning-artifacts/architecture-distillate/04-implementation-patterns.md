This section covers Implementation Patterns & Consistency Rules: naming/structural/format/communication/process patterns, enforcement (custom ESLint + pre-commit hooks), 11 single-source-of-truth modules, atomicity rules, 17 P11 fixtures, Bob's sharding notes. Part 4 of 9 from `architecture.md`.

## Orientation
- Section locks patterns BAD subagents follow when implementing AD set; pattern named only where it has project-specific consequence
- Discipline: single source of truth per concern; one path to do the thing prevents subagent divergence
- Omitted (don't apply to stack): SPA state management, GraphQL schemas, WebSocket conventions, API versioning

## Naming — Database
- snake_case everywhere: tables, columns, indexes, constraints, functions (Postgres convention; matches `@supabase/supabase-js`, `pg` client, Mirakl response field names → mechanical JSON↔column mapping)
- Plural table names: `customer_marketplaces`, `sku_channels`, `audit_log` (collective noun stays singular), `worker_heartbeats`, `moloni_invoices`
- Foreign keys: `<table_singular>_id` (`customer_marketplace_id`, `sku_id`, `cycle_id`); NO `fk_*` prefix
- Indexes: `idx_<table>_<columns>` (`idx_audit_log_customer_marketplace_id_created_at`); avoid `_001` numeric suffixes
- Constraints: `<table>_<col>_<kind>` (`customer_marketplace_cron_state_check`, `sku_channel_unique_customer_sku_channel`)
- Enum types: `<table>_<col>` or domain-prefixed (`cron_state`, `audit_log_priority`, `tier_value`)
- Enum values: UPPER_SNAKE_CASE for state machines (`'ACTIVE'`, `'PAUSED_BY_CUSTOMER'`); short lower-case for taxonomic (`'1'`, `'2a'`, `'2b'`, `'3'` for `tier_value`)
- Timestamps: `timestamptz` UTC; naming `<verb>_at` (`created_at`, `updated_at`, `last_won_at`, `last_checked_at`, `last_set_at`, `deletion_initiated_at`)

## Naming — URLs / Routes
- Customer-facing routes kebab-case; plural for collections, singular for state-of-self
- Plural collections: `/audit`, `/audit/firehose`, `/settings/marketplaces`
- Singular pages: `/onboarding/key`, `/onboarding/scan`, `/onboarding/scan-ready`, `/onboarding/margin`, `/settings/account`, `/settings/key`, `/settings/billing`, `/settings/delete`
- Internal: `/admin/status`
- Audit fragment endpoints (HTMX-ready per AD7): `/audit/_fragments/<name>` — `_fragments` segment marks partial-HTML returns
- Form-POST destinations mirror parent page (POST `/onboarding/key` posts to same path GET renders); NO `/api/v1/...` namespace (server-rendered, not JSON API)
- Webhooks scoped under `/_webhooks/`: `/_webhooks/stripe` (underscore = machine-callable, never linked from UI)
- Health endpoint: `/health` (PRD FR45 — UptimeRobot expects exact path)
- Source-context query params (FR7 funnel attribution): `source` and `campaign` — `/signup?source=free_report&campaign=tony_august` (locked to match DynamicPriceIdea CTA wiring)

## Naming — Code
- Filenames kebab-case (`api-client.js`, `pri01-writer.js`, `engine-decision.js`, `cron-state.js`); tests mirror source: `tests/<source-relative-path>.test.js`
- Module exports camelCase named exports: `export async function buildPri01Csv (...)`; default exports FORBIDDEN (break refactor tooling)
- Function name verb prefixes by side-effect class: `read*/fetch*/get*` = pure I/O reads (`fetchCompetitorOffers`, `getCustomerMarketplace`); `compute*/derive*/build*` = pure computation no I/O (`computeFloorPrice`, `buildPri01Csv`); `write*/persist*/record*` = DB writes (`writeAuditEvent`, `persistCronStateTransition`); `submit*/dispatch*` = Mirakl writes PRI01 only (`submitPriceImport`); `apply*/transition*` = state-machine transitions (`transitionCronState`, `applyTierClassification`)
- Variable naming camelCase; currency variables ALWAYS suffixed `Cents` (`floorPriceCents`, `competitorLowestCents`, `edgeStepCents`); display-formatted suffixed `Display` (`floorPriceDisplay`)
- JSDoc: every exported function carries `@param`, `@returns`, `@throws`; critical financial / state-mutation functions (margin math, decimal handling, PRI01 CSV serialization, cron-state transitions, encryption helpers) carry `@typedef` for shapes
- async/await ONLY; no `.then()` chains, no callbacks, no mixed promise handling (ESLint enforces)
- NO `console.log`; pino only per AD27 (ESLint + pre-commit hook double-check)

## Structural — 11 Single-Source-of-Truth Modules
- Mirakl HTTP requests → `shared/mirakl/api-client.js` (`mirAklGet`) — AD5: retry, redaction, error mapping centralized; ESLint rule `no-direct-fetch` flags imports of `node:fetch` or direct `fetch(` calls outside this module
- PRI01 CSV building → `shared/mirakl/pri01-writer.js` (`buildPri01Csv`) — AD7: per-SKU aggregation + delete-and-replace + delimiter consumption; ESLint rule flags raw csv-stringify outside this module
- PRI02 polling → `shared/mirakl/pri02-poller.js` (`pollImportStatus`) — AD7: race resolution + `pending_import_id` atomicity
- PRI03 error parsing → `shared/mirakl/pri03-parser.js` (`parseErrorReport`) — AD24: per-SKU rebuild semantics
- Audit event emission → `shared/audit/writer.js` (`writeAuditEvent`) — AD20: `event_type` + priority enum + structured payload; ESLint rule flags raw `INSERT INTO audit_log` outside
- Cron-state transitions → `shared/state/cron-state.js` (`transitionCronState`) — AD15: atomic state change + audit event in one transaction; ESLint rule flags raw `UPDATE customer_marketplaces SET cron_state` SQL outside
- Per-SKU freeze → `shared/state/sku-freeze.js` (`freezeSkuForReview`, `unfreezeSku`) — AD12: orthogonal to `cron_state`, audit emitted atomically
- Engine decision → `worker/src/engine/decide.js` (`decideForSkuChannel`) — AD8: full decision table; one function per (SKU, channel) decision
- Encryption envelope → `shared/crypto/envelope.js` (`encryptShopApiKey`, `decryptShopApiKey`) — AD3: master-key access localized; decryption only in worker context
- Self-filter → `shared/mirakl/self-filter.js` (`filterCompetitorOffers`) — AD13 + AD14: active + total_price + shop_name filter chain
- Money math → `shared/money/index.js` (`toCents`, `fromCents`, `roundFloorCents`, `roundCeilingCents`) — conservative rounding direction; integer-cents discipline
- Bob's sharding rule: any story touching one of these concerns extends existing module, never creates parallel implementation
- Custom ESLint rule (added Story 1.1) flags: imports of `node:fetch` or direct `fetch(` outside `api-client`; raw csv-stringify outside `pri01-writer`; raw `UPDATE customer_marketplaces SET cron_state` SQL outside `cron-state`

## Structural — Module Boundaries
- `shared/` — pure functions + module-level helpers usable by both `app/` and `worker/`; NO app-only Fastify imports; NO worker-only `pg` direct imports; DB access via factory functions parameterized by client
- `app/` — Fastify routes, middleware, eta views, RLS-aware DB client factory; `app/src/lib/` for app-only helpers (session, csrf, view-helpers)
- `worker/` — cron, dispatcher, engine, safety; `worker/src/lib/` for worker-only helpers (heartbeat write, batch utilities); uses service-role DB client
- `supabase/migrations/` — append-only SQL managed by Supabase CLI; NEVER edit a migration after applied to any environment
- `scripts/` — operational: `mirakl-empirical-verify.js` (AD16), `rotate-master-key.md` runbook (AD3), `rls-regression-suite.js` (AD30), `check-no-secrets.sh` (AD3 secret-scanning)
- `tests/` — mirrors source tree; `tests/shared/mirakl/api-client.test.js` matches `shared/mirakl/api-client.js`; integration tests under `tests/integration/`; RLS regression suite is `tests/integration/rls-regression.test.js`

## Structural — Atomicity Bundles (state mutation + audit event in single Postgres transaction)

### Bundle A — auth+profile creation (F3 lock, AD29)
- Single Postgres transaction kicked off by Supabase `auth.signUp({ options: { data: {...} } })`
- Trigger `handle_new_auth_user` on `auth.users` AFTER INSERT (`SECURITY DEFINER`)
- Validates `first_name`/`last_name`/`company_name` from `raw_user_meta_data` JSONB
- INSERTs `customers` + `customer_profiles` rows
- RAISE EXCEPTION on missing/empty rolls back ENTIRE auth.users INSERT (no orphan auth-without-profile state representable)
- HINT codes `PROFILE_FIRST_NAME_REQUIRED` / `PROFILE_LAST_NAME_REQUIRED` / `PROFILE_COMPANY_NAME_REQUIRED` mapped to PT-localized field errors
- Story 1.4 lands trigger + signup endpoint + JSON Schema validation + safe-error mapping + source-context capture in single PR

### Bundle B — state transition + audit emission (Step 5 pattern lock, AD15 + AD20)
- `writeAuditEvent` MUST be called inside the transaction performing the state change so event-and-state are atomic
- Signature: `writeAuditEvent({ tx, customerMarketplaceId, skuChannelId, eventType, cycleId, payload }) → Promise<{id, priority}>`
- One event per atomic state mutation; cycle processing 200 SKUs emits 200 events plus aggregate cycle-start/cycle-end; writer internal to dispatcher, not scattered
- Priority is DERIVED not specified: function looks up `eventType` against enum mapping (Atenção / Notável / Rotina) and stamps row's priority; subagents cannot mis-prioritize
- Payload structured never freeform string; each `event_type` has documented payload shape via JSDoc `@typedef PayloadFor<EventType>`; example: `external-change-absorbed` carries `{ previousListPriceCents, newListPriceCents, deviationPct }`; new event_type MUST add typedef in same PR
- `transitionCronState` atomic with audit emission in one transaction; signature: `transitionCronState({ tx, customerMarketplaceId, from, to, context })`; throws `InvalidTransitionError`, `ConcurrentTransitionError`
- Legal-transitions matrix defined as JS object literal at top of cron-state module — spec, not buried in conditionals; subagents see all 7 valid transitions in one place
- Optimistic concurrency via `from` parameter: UPDATE includes `WHERE cron_state = $from`; 0 rows updated → ConcurrentTransitionError; prevents races between webhook-driven and customer-action transitions
- Rejects illegal transitions (e.g., `'PAUSED_BY_CIRCUIT_BREAKER' → 'PAUSED_BY_CUSTOMER'` would skip manual unblock)
- `sku-freeze` emits audit atomically (orthogonal to `cron_state` per AD12)
- `writeAuditEvent` may accept `eventType: null` for non-engine state changes (Story 10.1 deletion-grace transition uses this — see AD20 Q2 decision)

### Bundle C — PRI01 atomic emission across all participating sku_channel rows (AD7)
- When PRI01 batch submitted, EVERY `sku_channel` row participating in batch (including channels whose price isn't changing — they appear as passthrough lines per delete-and-replace semantic) gets `pending_import_id = <import_uuid>` set in single transaction
- PRI02 COMPLETE clears `pending_import_id` for all rows in batch atomically
- PRI02 FAILED clears `pending_import_id` AND triggers per-SKU error handling per AD24
- Cooperative-absorption (AD9) skip-on-pending predicate depends on this atomicity to function correctly during in-flight imports
- **Bundle C gate at Story 7.8**: integration test asserts that for any in-flight PRI01 batch, ALL participating sku_channel rows have non-NULL `pending_import_id` matching same `import_uuid` (zero-tolerance for partial-set state); Story 7.8 ships the gate test; merging earlier engine/writer stories without Story 7.8 leaves Bundle C unverified

### Migration atomicity
- Every customer-scoped table migration includes its RLS policy in same file = same atomic deploy; RLS regression suite (AD30) verifies coverage

## Structural — Test Patterns
- Node built-in test runner (Step 3 lock); `npm test` runs `node --test --env-file-if-exists=.env.test 'tests/**/*.test.js'`
- Test naming: `tests/<source-path>.test.js` for unit; `tests/integration/<feature>.test.js` for integration
- Engine test fixtures at `tests/fixtures/p11/` as JSON files; fixture naming reflects case under test

## 17 P11 Fixtures (executable spec for AD8, MUST be preserved)
- `p11-tier1-undercut-succeeds.json`
- `p11-tier1-floor-bound-hold.json`
- `p11-tier1-tie-with-competitor-hold.json`
- `p11-tier2a-recently-won-stays-watched.json`
- `p11-tier2b-ceiling-raise-headroom.json`
- `p11-tier3-no-competitors.json`
- `p11-tier3-then-new-competitor.json`
- `p11-all-competitors-below-floor.json` (Pedro-flagged sub-case)
- `p11-all-competitors-above-ceiling.json`
- `p11-self-active-in-p11.json` (engine still filters via shop_name AD13)
- `p11-self-marked-inactive-but-returned.json` (caught by AD14 filter)
- `p11-single-competitor-is-self.json` (post-self-filter empty → Tier 3 AD8 STEP 1)
- `p11-zero-price-placeholder-mixed-in.json` (Strawberrynet-style; AD14 filter)
- `p11-shop-name-collision.json` (two offers match own shop_name; AD13 collision detection fires)
- `p11-pri01-pending-skip.json` (`pending_import_id` set; engine SKIPs SKU)
- `p11-cooperative-absorption-within-threshold.json`
- `p11-cooperative-absorption-anomaly-freeze.json` (>40% deviation triggers freeze AD12)
- One-test-per-AD discipline: each engine AD has at least one fixture for happy path AND negative path; coverage fixture-driven not LoC-driven
- Golden-file pattern for PRI01 CSV: `tests/fixtures/pri01-csv/<scenario>.csv` = expected serialization for given engine + writer state; CSV bytes compared exactly (delimiter, line endings, decimal separator)
- Pact-style Mirakl mocking: `tests/mocks/mirakl-server.js` = Fastify server standing in for `marketplace.worten.pt`, replays fixture responses; same fixtures in CI and dogfood replay; seeded from `verification-results.json` (live Worten captures 2026-04-30) — replacing seed with synthetic data weakens dogfood-validation chain
- Bob's stories adding new engine logic include fixture file in story acceptance; stories shipping new path without fixture FAIL review

## Format — Money
- ALWAYS integer cents in code and DB; €17.99 = 1799 (int), NEVER 17.99 (float) anywhere
- Schema columns: `price_cents INTEGER NOT NULL`, `floor_price_cents INTEGER NOT NULL`, `min_shipping_price_cents INTEGER`
- Mirakl returns prices as JSON numbers (e.g., 21.54) → converted to cents (2154) at boundary in `shared/mirakl/api-client.js` response normaliser
- Conservative rounding: `roundFloorCents(rawFloor)` rounds UP (`Math.ceil`) — floor never sinks below raw; `roundCeilingCents(rawCeiling)` rounds DOWN (`Math.floor`) — ceiling never exceeds raw; both in `shared/money/index.js`
- Display formatting at eta template boundary ONLY: `{{ formatEur(priceCents) }}` → '€17,99' (PT locale comma decimal); never store formatted string; never reverse-parse
- `edgeStepCents = 1` (€0.01) is unit for both undercut and ceiling-raise per AD8; NOT 0.01 (float)

## Format — Dates / Timezones
- DB columns `timestamptz` (Postgres stores UTC)
- Application code uses UTC throughout; `new Date()` acceptable; format conversion at output
- Customer-facing display in Europe/Lisbon: eta helper `{{ formatLisbon(timestampUtc) }}`; audit log entries serialize as '29/04/2026 17:32:14' for customer view; UTC ISO 8601 for diagnostics view
- Mirakl wire format: ISO 8601 with Z (`'2024-01-01T23:00:00Z'`) per [MCP: PRI01 examples]; PRI01 writer emits exactly this format if discount-date columns ever needed (Worten doesn't require — [Empirical: PC01 `discount_period_required: false`])

## Format — JSON
- snake_case in ALL JSON wire formats; matches Mirakl response, Supabase response, Postgres column names; NO camelCase↔snake_case translation layers (cost: unfamiliarity for JS-default eyes; benefit: grep-ability + zero translation bugs)
- JSON for diagnostics + Stripe webhooks + audit-log fragment payloads, NOT customer-facing UI (server-rendered HTML)
- NO envelope — return resource directly; Stripe webhooks accept their JSON envelope unchanged; audit-log fragment endpoints return HTML not JSON
- Error responses (when JSON): `{ error: { code: 'WORTEN_API_KEY_INVALID', message_pt: 'Chave inválida' } }`; code = program-readable identifier; `message_pt` = customer-facing message; NEVER include raw upstream error text

## Format — CSV (PRI01)
- Encoding: UTF-8 without BOM [Empirical-pending — calibrate during dogfood]
- Decimal separator: ASCII period (`.`); CSV standard regardless of locale; if Worten dogfood reveals comma required, configurable via `customer_marketplace.csv_decimal_separator` column
- Delimiter: captured per-marketplace from PC01 in `customer_marketplace.operator_csv_delimiter` [Empirical: Worten = SEMICOLON]; writer reads column at write time, never hardcoded
- Line endings: `\n` (LF); Mirakl docs don't specify; LF safe lowest-common-denominator
- Header row required per [MCP: PRI01]: `offer-sku;price;channels` (Worten MVP set per AD7)
- Quoting: field values quoted only when containing delimiter or newline; standard CSV escape (double-quote inside quoted field)

## Communication — Mirakl Error Mapping
- Every Mirakl error reaches customer through `getSafeErrorMessage(err)` per AD5 (ported from DynamicPriceIdea); NEVER pass `err.message` directly to customer-facing template, NEVER include Mirakl response body in banner, NEVER log full error response (could echo headers including ours)
- Custom ESLint rule `no-raw-error-to-template` flags any usage of `err.message`, `err.response`, `err.body` inside `app/views/` template render paths

## Communication — Multi-tenant Filtering
- App context (RLS-aware client): queries do NOT manually filter by `customer_marketplace_id`; RLS does it; `SELECT * FROM sku_channel WHERE id = $1` safe — RLS rejects rows not owned by JWT subject
- Worker context (service-role client): queries MUST manually filter by `customer_marketplace_id` (RLS bypassed); custom ESLint rule `worker-must-filter-by-customer` flags any `from('sku_channel')`/`from('audit_log')`/etc. without `.eq('customer_marketplace_id', ...)` clause OR explicit `// safe: cross-customer cron` comment
- `shared/db/` factory functions: `getRlsAwareClient(jwt)` (app) vs `getServiceRoleClient()` (worker); JSDoc on each factory states multi-tenant contract

## Process — Migrations
- One schema change per migration file; filename `YYYYMMDDHHMM_<verb>_<noun>.sql` (Supabase CLI default)
- Append-only; never edit migration after applied to any environment; to fix wrong migration, write new one
- Every customer-scoped table migration includes RLS policy in same file (atomic deploy); RLS regression suite AD30 verifies coverage
- Down migrations NOT maintained at MVP — Supabase forward-only; rollback = write new reversing migration; solo-founder velocity tradeoff

## Process — Logging
- pino ONLY; no `console.log`, no `console.error`, no `process.stdout.write` (except `scripts/` ops scripts where deliberate output channel)
- Redaction list (AD27, locked — adding new sensitive field requires extending list in same PR): `Authorization`, `cookie`, `set-cookie`, `password`, `password_hash`, `shop_api_key`, `master_key`, `MASTER_KEY_BASE64`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`
- Log levels: trace (disabled prod; per-request fine detail in dev), debug (disabled prod; cycle-step traces), info (cycle-start, cycle-end, customer signup, Go-Live click), warn (retried failures, rate-limit backoff triggers, sustained-transient banner triggers), error (critical events: anomaly freeze, circuit breaker, key revoked, payment failure)
- Structured fields: every log line carries `customer_marketplace_id` (or null pre-auth), `request_id` (app) or `cycle_id` (worker), `event_type` if line corresponds to audit event

## Process — Error Handling
- Throw + global handler; routes throw, Fastify global error handler converts to safe responses; NO try/catch inside individual routes for general error mapping (only catch where specific action: retry, fall through, transform error class)
- Custom error classes for predictable conditions: `MiraklApiError`, `RlsViolationError`, `InvalidTransitionError`, `ConcurrentTransitionError`, `KeyVaultDecryptError`; each carries `safeMessagePt` (PT-localized customer text) AND `code` (program-readable identifier)
- Unhandled errors → generic 500 with `safeMessagePt: 'Ocorreu um erro inesperado. Tenta novamente ou contacta o suporte.'`; stack trace logged server-side (with redaction); never exposed to client

## Process — Loading States
- Server-rendered = NO client-side loading state, except where long-running async job exists
- Two MVP async jobs: (1) Catalog scan (UX skeleton §3.3 + AD16) — page polls `GET /onboarding/scan/status` every 1s; renders 4-phase progress; reconnection-safe per FR14; (2) Inline key validation (FR9, ≤5s per NFR-P6) — button disables, shows spinner, posts to `/onboarding/key/validate`, awaits response
- Audit log filters server-rendered HTML; NO client-side debounce-then-fetch; form submission re-renders page (or fragment if HTMX added Epic 2)

## Pattern A / B / C UI Surface Contracts
- Pattern A (Stubbed UI surface, 17 surfaces): story acceptance cites 3 pointers — Behavior=PRD FR/NFR by number; Structure=UX skeleton § by number; Visual=`_bmad-output/design-references/screens/<NN>-<name>.html` stub filename; includes 16 dashboard/audit/onboarding surfaces (`01-…` through `12-…` + `06b-…` + `16-onboarding-key-help.html`)
- Pattern B (Skeleton with explicit visual fallback, 2 surfaces): story acceptance cites — Behavior=PRD FR/NFR; Structure+Visual=UX skeleton § + named visual fallback; concrete cases — `/onboarding/scan` (FR12-FR14) UX skeleton §3.3 + visual fallback `bundle/project/MarketPilot.html` ProgressScreen; `/onboarding/margin` (FR16) UX skeleton §3.3 + visual-DNA tokens
- Pattern C (Skeleton + Supabase chrome / DNA tokens, 10 surfaces): story acceptance cites — Behavior=PRD FR/NFR; Structure=UX skeleton § (sitemap entry or §4.4 settings row); Visual=explicit fallback statement; concrete cases — 5 auth screens (`/signup`, `/login`, `/forgot-password`, `/reset-password`, `/verify-email`) UX skeleton §1 sitemap + Supabase Auth defaults + visual-DNA tokens (Manrope/Inter, navy primary, radius scale); 5 settings pages (`/settings/account`, `/settings/key`, `/settings/marketplaces`, `/settings/billing`, `/settings/delete`) UX skeleton §4.4 settings row + visual-DNA tokens + consistent chrome from already-shipped designed pages

## Enforcement — Pre-Review Mechanical Checks
- ESLint base ruleset (`no-console`, async-only, `no-default-export`) — ESLint config — Story 1.1
- JSDoc completeness on exported functions — Custom ESLint rule — Story 1.1
- `no-raw-error-to-template` (no `err.message` in eta render) — Custom ESLint rule — Story 1.x
- `worker-must-filter-by-customer` (worker queries filter by `customer_marketplace_id`) — Custom ESLint rule — Story 2.x
- Single-source-of-truth import discipline (no direct `fetch(` outside `api-client`; no raw CSV building outside `pri01-writer`; no raw SQL `UPDATE customer_marketplaces SET cron_state` outside `cron-state`) — Custom ESLint rules — Story 1.x and per-AD
- Secret-pattern pre-commit hook — `scripts/check-no-secrets.sh` — Story 1.2
- Migration filename + content lint — Supabase CLI native — Story 1.1
- RLS regression suite — `npm run test:rls` in CI — Story 2.x
- Engine fixture coverage (every AD8 case has fixture file) — test file presence asserted in CI — Story 7.x
- Pino redaction assertion (test that secret values do not appear in pino.stream output) — Unit test — Story 1.4

## Pattern Examples (Good vs Anti-Pattern)
- Money GOOD: `import { roundFloorCents, fromCents } from '../../../shared/money/index.js'; const floorCents = roundFloorCents(listPriceCents * (1 - maxDiscountPct)); auditPayload.floorPriceCents = floorCents; templateData.floorPriceDisplay = fromCents(floorCents) // '€17,99'`
- Money ANTI: float math (`list_price * (1 - max_discount_pct)`); ad-hoc rounding wrong direction (`Math.round(floor * 100) / 100`); float in DB; ad-hoc PT format (`€${floor.toFixed(2).replace('.', ',')}`)
- Cron-state GOOD: `await transitionCronState({ tx, customerMarketplaceId, from: 'ACTIVE', to: 'PAUSED_BY_CUSTOMER', context: { initiated_at: new Date().toISOString() } })`
- Cron-state ANTI: raw `UPDATE customer_marketplaces SET cron_state = 'PAUSED_BY_CUSTOMER' WHERE id = $1`; audit event written separately or forgotten or wrong priority
- Mirakl GOOD: `import { mirAklGet } from '../../../shared/mirakl/api-client.js'; const a01 = await mirAklGet(baseUrl, '/api/account', null, apiKey)`
- Mirakl ANTI: raw `await fetch(\`${baseUrl}/api/account\`, { headers: { Authorization: apiKey } })`; no retry, no error mapping, key potentially logged on error
- Audit event GOOD: `await writeAuditEvent({ tx, customerMarketplaceId, skuChannelId, eventType: 'EXTERNAL_CHANGE_ABSORBED', cycleId, payload: { previousListPriceCents, newListPriceCents, deviationPct: 0.034 } })`
- Audit event ANTI: raw `INSERT INTO audit_log (customer_marketplace_id, event_type, message) VALUES ($1, 'absorbed', 'Price changed externally')`; freeform message, no priority, no structured payload, can't be machine-queried

## Notes for Bob (Story Sharding)
- ESLint custom-rule timing: ~5 custom rules listed (`no-raw-error-to-template`, `worker-must-filter-by-customer`, single-source-of-truth import discipline, etc.) require AST-walking logic — non-trivial; pragmatic shard:
- Story 1.1: vanilla ESLint + conventions documented as comments at top of each single-source-of-truth module; NO custom rules yet
- Story 1.2: custom rules for 3-4 highest-leverage modules — `shared/mirakl/api-client.js` (no direct fetch), `shared/audit/writer.js` (no raw `INSERT INTO audit_log`), `shared/money/index.js` (no float price math); prevents most-likely-to-bite divergence
- Stories 2.x onward: remaining custom rules per relevant story (`worker-must-filter-by-customer` lands with first cron-loop story; `no-raw-error-to-template` lands when first eta render touches Mirakl errors)
- Avoids front-loading lint config into 1.1 (already covers scaffold + worker heartbeat + /health per AD1+AD23) without deferring enforcement so far subagents drift; custom rules attach to whichever Story 1.x most-naturally introduces protected module (no-direct-fetch lands with 1.2 if `shared/mirakl/api-client.js` ships in 1.2's envelope-encryption work, else lands with Story 3.1 when api-client port lands)
- Engine fixture preservation: 17 P11 fixtures NOT optional — executable spec for AD8; every engine story references fixtures by filename in story acceptance criteria (e.g., "Story 7.1 implements contested-position branch and passes `p11-tier1-undercut-succeeds.json`, `p11-tier1-floor-bound-hold.json`, `p11-tier1-tie-with-competitor-hold.json`"); Mirakl mock server seeds from `verification-results.json` (live Worten captures 2026-04-30) — preserve seed; replacing with synthetic weakens dogfood-validation chain
