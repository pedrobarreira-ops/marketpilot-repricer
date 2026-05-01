---
type: bmad-distillate
sources:
  - "../architecture.md"
downstream_consumer: "bmad-create-story (Bob), bmad-dev-story (Amelia), bmad-code-review with architecture-compliance auditor"
created: "2026-05-01"
token_estimate: 52000
parts: 9
---

## Orientation
- Distilled from `_bmad-output/planning-artifacts/architecture.md` (~53K tokens, 2,506 lines, status: complete, completedAt 2026-04-30)
- Project: MarketPilot Repricer — multi-tenant SaaS automating Mirakl marketplace pricing for Worten sellers; pre-build planning phase complete
- Stack pre-locked: Node.js >=22, Fastify v5, Postgres on Supabase Cloud EU, Hetzner via Coolify, MMP-only direct shop API key (no MiraklConnect), PRI01-only writes (OF24 forbidden — resets unspecified offer fields)
- Methodology: BMAD Method (full workflow: product-brief → PRD → architecture → epics → stories → dev → review)
- Empirical grounding: live Worten verification via Gabriel's Easy-Store account (shop_id 19706), 2026-04-30, captured in `verification-results.json` (gitignored)
- Distillate is split into 9 self-contained sections; load specific sections selectively or load `_index.md` + the section relevant to your task

## Section Manifest
- [01-context-and-scaffold.md](01-context-and-scaffold.md) — Frontmatter pre-locked decisions, FRs/NFRs/UX-skeleton overview, hard constraints, code-reuse from DynamicPriceIdea/Gabriel, frontend approach (NO SPA, NO bundler), npm dependency baseline, project structure, scaffold-provided decisions (JS-ESM, Fastify built-in JSON Schema validation, NO TypeScript at MVP, NO zod, NO Prettier, NO Drizzle, NO Jest), Story 1.1 acceptance criteria
- [02-decisions-A-D.md](02-decisions-A-D.md) — AD1-AD20: Service Topology (AD1-AD4), Mirakl Integration (AD5-AD14, including full AD8 engine decision table + AD7 PRI01 9-point semantic), Cron Architecture (AD15-AD18, including all 8 cron_state enum values + AD17 dispatcher SQL), Audit Log (AD19-AD20, including the 28 audit event types)
- [03-decisions-E-J.md](03-decisions-E-J.md) — AD21-AD30 + Deferred Decisions + Decision Impact Analysis + Worten Positioning Note: Account Lifecycle & Billing (AD21-AD22 with Stripe F2 model + Moloni + NIF capture), Operations & Failure Modes (AD23-AD27 with 3-tier model + AD20 cycle-fail-sustained + AD26 monthly PC01 re-pull), Important Decisions (AD28-AD30 with AD29 atomic auth+profile pattern + AD30 RLS regression suite)
- [04-implementation-patterns.md](04-implementation-patterns.md) — Naming/Structural/Format/Communication/Process patterns, Enforcement (custom ESLint rules + pre-commit hooks), 11 single-source-of-truth modules, atomicity rules (writeAuditEvent + transitionCronState atomic with state mutation), 17 P11 fixtures enumerated, Bob's sharding notes
- [05-directory-tree.md](05-directory-tree.md) — Complete project directory tree (every file location BAD subagents need); migration ordering with F-amendment inline comments
- [06-database-schema.md](06-database-schema.md) — Full DDL: 14 tables + cron_state enum + channel_pricing_mode enum + tier_value enum + audit_log_priority enum + handle_new_auth_user trigger (F3) + audit_log_set_priority trigger + customer_marketplace_provisioning_completeness CHECK constraint (F4) + audit_log monthly partitioning (AD19) + RLS policy summary + FK ON DELETE summary + Epic 2 schema reservations
- [07-fr-mapping-integrations-workflows.md](07-fr-mapping-integrations-workflows.md) — FR/AD → file mapping table (load-bearing for code-review architecture-compliance auditing), external integration boundaries (Mirakl/Supabase/Stripe/Resend/UptimeRobot/Moloni), internal boundaries (App↔Worker via Postgres only), engine-cycle data flow trace, notable absences (no APIs, no pooler, no CDN, no Redis), dev/deploy workflows
- [08-amendments-and-validation.md](08-amendments-and-validation.md) — All 13 post-completion amendments F1-F13 (Pass 1: F1-F11 critical-and-important fixes; Pass 2: F12-F13 stale-reference + casing drift), coherence validation cross-references, requirements coverage table, completeness checklist, Pedro's two flagged checks verified, Architecture Readiness Assessment (READY, HIGH confidence), UNVERIFIED items deferred to dogfood
- [09-visual-design-asset-class.md](09-visual-design-asset-class.md) — Post-completion supplement: visual-contract sourcing for downstream story sharding; Pattern A/B/C UI surface contracts; stable-stub-filename strategy; ~28 screens (16 Claude-Design-mocked, 12 fallback-pattern)

## Cross-Cutting Constraints (Negative Assertions — apply across all sections)
- NO SPA framework; NO bundler; NO TypeScript at MVP (JS-ESM with JSDoc only — `*.js → *.ts` rename trivial later)
- NO zod (Fastify built-in JSON Schema validation suffices at MVP)
- NO Prettier (one less config at solo-founder scale)
- NO Drizzle (Supabase CLI migrations only — Drizzle's TS-only ergonomics conflict with JS-ESM-with-JSDoc convention)
- NO Jest/Vitest (built-in `node --test` runner only)
- NO pm2, NO systemd (Coolify owns process lifecycle)
- NO Mirakl webhooks for Seller users (MCP-confirmed unavailable; polling-only architecture per AD18); internal Stripe webhooks ARE used
- NO Redis at MVP (no BullMQ; queue equivalent is `pri01_staging` table + Postgres advisory locks)
- NO CDN at MVP (`@fastify/static` direct; Cloudflare in front of Coolify is Epic 2 trigger)
- NO connection pooler at MVP (`pg` internal pool sufficient at 5–10 customers, single worker; PgBouncer/Supavisor is Epic 2)
- NO ES UI at MVP (PT-default per NFR-L1; ES UI deferred to Epic 2 per NFR-L2)
- NO MiraklConnect (MMP only — direct shop API key)
- NO OF24 ever (resets unspecified offer fields — never use for price-only updates; PRI01 only)
- NO AWS / GCP / Azure at MVP (Hetzner via Coolify + Supabase Cloud EU only)
- NO `npx create-*` bootstrap (hand-scaffolded with explicit deps)
- NO console.log (pino only per AD27; ESLint + pre-commit hook double-check)
- NO `default export` (breaks refactor tooling — ESLint enforces named exports only)
- NO `.then()` chains (async/await only — ESLint enforces)
- NO float price math anywhere (integer cents discipline; ESLint flag on raw float arithmetic in money paths)
- NO direct `fetch(` outside `shared/mirakl/api-client.js` (custom ESLint rule no-direct-fetch)
- NO raw `INSERT INTO audit_log` outside `shared/audit/writer.js` (custom ESLint rule)
- NO raw `UPDATE customer_marketplaces SET cron_state` outside `shared/state/cron-state.js` (custom ESLint rule)
- NO `err.message` / `err.response` / `err.body` in eta render paths (custom ESLint rule no-raw-error-to-template)
- NO worker query without `.eq('customer_marketplace_id', ...)` (custom ESLint rule worker-must-filter-by-customer; explicit `// safe: cross-customer cron` comment opt-out)
- NO mid-session `default export`, decorative bold for emphasis, or freeform string audit payloads (every event_type has documented `@typedef PayloadFor<EventType>`)
- NO marketing emails / day-3 / day-7 pulse-check templates via Resend (founder-direct per NFR-O3; Resend for critical-tier alerts ONLY)
- NO customer-facing API endpoints (UI server-rendered only; JSON only for Stripe webhooks inbound + audit-log fragment endpoints which return HTML despite "fragment" naming)

## Cross-Cutting Atomicity Bundles
- **Bundle A — auth+profile creation (F3 lock, AD29)**: Single Postgres transaction kicked off by Supabase `auth.signUp({ options: { data: {...} } })`; trigger `handle_new_auth_user` on `auth.users` AFTER INSERT (`SECURITY DEFINER`); validates `first_name`/`last_name`/`company_name` from `raw_user_meta_data` JSONB; INSERTs `customers` + `customer_profiles` rows; RAISE EXCEPTION on missing/empty rolls back ENTIRE auth.users INSERT (no orphan auth-without-profile state representable); HINT codes `PROFILE_FIRST_NAME_REQUIRED` / `PROFILE_LAST_NAME_REQUIRED` / `PROFILE_COMPANY_NAME_REQUIRED` mapped to PT-localized field errors; Story 1.4 lands trigger + signup endpoint + JSON Schema validation + safe-error mapping + source-context capture in single PR
- **Bundle B — state transition + audit emission (Step 5 pattern lock, AD15 + AD20)**: `transitionCronState({ tx, customerMarketplaceId, from, to, context })` performs `UPDATE customer_marketplaces SET cron_state = $to WHERE id = $1 AND cron_state = $from` (optimistic concurrency: 0 rows → ConcurrentTransitionError) AND calls `writeAuditEvent({ tx, ..., eventType, ... })` in SAME transaction; legal-transitions matrix in `shared/state/transitions-matrix.js` defines all 7 valid transitions as JS object literal at top of cron-state module; rejects illegal transitions (e.g., 'PAUSED_BY_CIRCUIT_BREAKER' → 'PAUSED_BY_CUSTOMER' would skip manual unblock); identical pattern for `freezeSkuForReview` (AD12 — atomic with audit emission, orthogonal to cron_state); `writeAuditEvent` may accept `eventType: null` for non-engine state changes (Story 10.1 deletion-grace transition uses this — see AD20 Q2 decision)
- **Bundle C — PRI01 atomic emission across all participating sku_channel rows (AD7 + Bundle C gate at Story 7.8)**: When PRI01 batch submitted, EVERY `sku_channel` row participating in batch (including channels whose price isn't changing — they appear as passthrough lines per delete-and-replace semantic) gets `pending_import_id = <import_uuid>` set in single transaction; PRI02 COMPLETE clears `pending_import_id` for all rows in batch atomically; PRI02 FAILED clears `pending_import_id` AND triggers per-SKU error handling per AD24; cooperative-absorption (AD9) skip-on-pending predicate depends on this atomicity to function correctly during in-flight imports; **Bundle C gate at Story 7.8**: integration test asserts that for any in-flight PRI01 batch, ALL participating sku_channel rows have non-NULL pending_import_id matching same import_uuid (zero-tolerance for partial-set state); Story 7.8 ships the gate test; merging earlier engine/writer stories without Story 7.8 leaves Bundle C unverified

## Cross-Cutting Empirically-Verified Mirakl Facts (do NOT re-question)
- `shop_id` is `null` in P11 competitor offers across all 30 returned offers in 3 verification calls — `shop_name` is the only reliable self-identification key (AD13)
- P11 placeholder offers with `total_price = 0` returned in production (Strawberrynet at rank 0 in PT and ES P11 calls); engine MUST filter `o.total_price > 0` (AD14 mandatory filter chain)
- Worten `channel_pricing` is `SINGLE` (PC01) — engine writes one price per (SKU, channel); `MULTI`'s tiered pricing capability unused at MVP (AD6)
- Worten `operator_csv_delimiter` is `SEMICOLON` (PC01) — never hardcode `,` in PRI01 writer (AD7)
- Worten `offer_prices_decimals` is `2` (PC01) — `customer_marketplace.offer_prices_decimals` reads live value
- Worten `discount_period_required: false`, `scheduled_pricing: false`, `volume_pricing: false` (PC01) — PRI01 CSV column set is `offer-sku;price;channels` only at MVP
- Worten `competitive_pricing_tool: true` (PC01) — affects free-report sales positioning (Worten sellers see per-product competition in seller portal); does NOT change engine spec
- P11 batch lookup uses `product_references=EAN|xxx,EAN|yyy` NOT `product_ids` (silently returns 0 products if EANs passed there)
- P11 default page size 10 offers; need only top 2 for repricing
- Worten Mirakl auth header is raw `Authorization: <api_key>` — NO `Bearer` prefix
- A01 returns `shop_id`, `shop_name`, `channels[]`, `currency_iso_code`, `state`, `is_professional`, `domains[]` — Easy-Store: shop_id 19706, shop_name "Easy - Store"
- OF21 returns `shop_sku` as seller-provided SKU (e.g., `EZ8809606851663`), `offer_sku: null`, `product_sku` is Mirakl's internal UUID (NOT seller SKU); `shop_sku` is value to use in PRI01 `offer-sku` column
- P11 per-channel pattern: `pricing_channel_code` AND `channel_codes` both set per call; channel bucketing determined by which call returned the offer (NOT by reading `offer.channel_code` or `offer.channels` — neither exists/populated for competitor offers)
- Mirakl webhooks/Cloud Events available for Operator users only, NOT Seller users — polling-only architecture mandatory (AD18)
- Channel codes `WRT_PT_ONLINE` / `WRT_ES_ONLINE` confirmed in production (DynamicPriceIdea scanCompetitors.js)
- Retry schedule: 5 retries, exponential backoff `[1s, 2s, 4s, 8s, 16s]`; retryable on 429 + 5xx + transport errors; non-retryable on 4xx (except 429); max attempt cap 30s per delay
- EAN resolution (3-strategy in DynamicPriceIdea): `product.product_references` EAN entry → `product.product_sku` → single-EAN-batch fallback

## Cross-Cutting Pre-Locked Decisions (frontmatter)
- A1: Stripe `cancel_at_period_end=true` at deletion initiation; manual goodwill refund only
- B1: App-layer envelope encryption (AES-256-GCM); master in Coolify env on Hetzner; ciphertext in Postgres; annual rotation ceremony + on-incident; 1Password cold backup; GitHub secret-scanning + pre-commit hook
- C: Single `cron_state` enum on `customer_marketplace` (PROVISIONING | DRY_RUN | ACTIVE | PAUSED_BY_CUSTOMER | PAUSED_BY_PAYMENT_FAILURE | PAUSED_BY_CIRCUIT_BREAKER | PAUSED_BY_KEY_REVOKED | PAUSED_BY_ACCOUNT_GRACE_PERIOD); per-SKU `frozen_for_anomaly_review` orthogonal; dispatcher predicate `WHERE cron_state = 'ACTIVE'`; PROVISIONING value added F4 for onboarding-scan transient state; UPPER_SNAKE_CASE per Step 5 pattern doc
- Engine edge logic: single `edge_step_cents=1` hardcoded MVP, schema-reserved per-marketplace; covers BOTH undercut and ceiling-raise; graceful floor degradation candidate=`MAX(competitor-edge_step, floor)`; HOLD on tie; ceiling mirror `MIN(competitor_2nd-edge_step, ceiling)`
- Schema reservations for Epic 2 (no migration later): `customer_marketplace.anomaly_threshold_pct`, `customer_marketplace.tier_cadence_minutes_override`, `customer_marketplace.edge_step_cents`, `sku_channel.cost_cents`, `sku_channel.excluded_at`
- Tier 2b cadence: 45 min starting default in `tier_cadence_minutes` column
- PRI01/PRI02 race resolution: `pending_set_price` + `pending_import_id`; cooperative-absorption logic skips SKUs with in-flight imports
- Audit log: monthly partitioning + compound indexes + precomputed `daily_kpi_snapshots` and `cycle_summaries` tables (mandatory for NFR-P8 at projected volume)
- Customer profile schema: `first_name`, `last_name`, `company_name` all NOT NULL at signup; written atomically with Supabase Auth user creation (single transaction, no orphan auth-without-profile state); NIF deliberately deferred to invoice-generation moment
- Auth header format: raw `Authorization: <key>` on Worten Mirakl (NO Bearer prefix); confirmed via DynamicPriceIdea production client

## MCP Verification List (Q1-Q15) — Status Snapshot
- Q1: PRI01 per-channel write mechanism — RESOLVED via AD7 (channels column pipe-separated)
- Q2: Channel codes WRT_PT_ONLINE / WRT_ES_ONLINE — empirically confirmed; MCP-confirm to lock
- Q3: Cross-channel parity rules between PT and ES — handled per AD7 per-SKU passthrough semantics
- Q4: P11 single-channel offer return — handled per AD8 single-channel-offer edge case
- Q5: all_prices array shape — empirically per-channel calls with `pricing_channel_code` is the production pattern; MCP confirm whether all_prices alternative exists
- Q6: Source of own-shipping cost per offer (OF21 returns it) — confirmed
- Q7: P11 / PRI01 rate limits + per-customer cadence ceiling for 100k+ catalogs — UNVERIFIED, calibrate during dogfood
- Q8: KMS spec — RESOLVED by B1 lock; spec writes rotation procedure
- Q9: `active=true` offer filtering — empirically confirmed reliable; MCP-confirm semantics
- Q10: PRI01 partial-success / EAN mismatch / pricing-import failures — MCP-confirmed; AD7 / AD24 spec
- Q11: P11 pagination — empirically default 10, max param exists; confirm max value via MCP
- Q12: PRI01 CSV exact format — column names, header row, UTF-8 BOM, decimal separator (PT comma vs dot) — DECIMAL SEPARATOR UNVERIFIED for Worten, calibrate empirically during dogfood
- Q13: PRI01 idempotency — RESOLVED at MCP doc level; validate operationally during dogfood
- Q14: Mirakl webhook / push notifications for external price changes — RESOLVED (Seller users have no webhooks; default polling regardless)
- Q15: Identifying own listing in P11 response — defensive shop_name filter per AD13 handles either auto-exclude or no-auto-exclude reality
