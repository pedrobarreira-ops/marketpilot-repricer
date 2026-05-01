This section covers Core Architectural Decisions A-D: Service Topology + Tenancy + Trust (AD1-AD4), Mirakl Integration (AD5-AD14), Cron Architecture & State Machine (AD15-AD18), Audit Log Architecture (AD19-AD20). Part 2 of 9 from `architecture.md`.

## A. Service Topology, Tenancy, Trust

### AD1 — Two services, one repo, one image, two start commands
- Single npm package with `app/` and `worker/` entry points (`npm run start:app` / `npm run start:worker`)
- Coolify deploys two service instances from same git repo: `app.marketpilot.pt` (Fastify, public, port 3000) and `repricer-worker` (cron, no public URL)
- Share image and codebase; differentiation = start command + per-service env-var subset
- Why: matches distillate §13 (no monorepo); preserves shared-code reuse via `shared/` symlinked into both build trees; Coolify supports per-service start-command override
- Affects: FR45 (/health), NFR-Sc1 (5–10 customers MVP), NFR-Sc3 (horizontal scale)
- Bob trace: Story 1.1 scaffolds structure + configures Coolify two-service deploy

### AD2 — Multi-tenant isolation enforced at Postgres RLS layer; client/worker connection split
- App: `@supabase/supabase-js` with customer JWT bound at request scope; RLS policies fire automatically; service-role key NEVER reaches customer-facing code path
- Worker: `pg` directly with service-role connection string; allows raw `pg_try_advisory_lock(customer_id)`; bypasses RLS for cross-customer cron work; uses `@supabase/supabase-js` only for auth-system reads when needed
- Every customer-scoped table carries RLS policy keyed on `customer_id`; policy set regression-tested every deploy via `scripts/rls-regression-suite.js`
- Why: NFR-S3 (RLS at DB layer), NFR-I3 (RLS regression per deploy), trust-architecture commitment (FR5/FR6)
- Affects: every customer-scoped data access in app; every cross-customer query in worker
- Bob trace: Story 2.1 (RLS policy seed + first regression test); Story 2.x (RLS regression suite covering every customer-scoped table; runs in CI on every deploy)

### AD3 — Encrypted shop_api_key vault: app-layer envelope encryption (B1 lock)
- AES-256-GCM envelope encryption; master key (`MASTER_KEY_BASE64`) loaded from Coolify env at process start; held in process memory only; never written to disk; never logged
- Each customer's `shop_api_key` encrypted with master + stored as ciphertext + nonce + auth tag in `shop_api_key_vault`
- Decryption is on-demand, scoped to worker process during cron cycles only — app server never holds plaintext
- Master key custody: Coolify-managed env var (encrypted at rest by Coolify on Hetzner disk); cold backup: 1Password vault, founder-only access
- Rotation cadence: annual ceremony; on-demand if compromise suspected; runbook in `scripts/rotate-master-key.md`
- Rotation procedure (5 steps): 1. Generate new master key with `openssl rand -base64 32`; 2. Coolify deploys new master as `MASTER_KEY_BASE64_NEXT` alongside existing `MASTER_KEY_BASE64`; 3. Worker re-encrypts every `shop_api_key_vault` row: decrypt with `MASTER_KEY_BASE64`, re-encrypt with `MASTER_KEY_BASE64_NEXT`, atomic swap; concurrency-safe via per-row advisory lock (uses customer_id); 4. Coolify swap: rename `MASTER_KEY_BASE64_NEXT` → `MASTER_KEY_BASE64`, delete old; 5. 1Password backup updated
- Repo defense: GitHub secret-scanning enabled; pre-commit hook (`scripts/check-no-secrets.sh`) blocks commits matching `MASTER_KEY|shop_api_key|sk_live_|sk_test_` patterns
- Verification: zero plaintext key occurrences in DB dumps (asserted pre-launch and ongoing)
- master_key_version column on shop_api_key_vault supports rotation versioning
- Why: NFR-S1 (encryption-at-rest non-negotiable); trust commitment we're selling; CLAUDE.md trust-critical component mandate
- Affects: FR8 (key entry), FR9 (validation), FR11 (encryption at rest); every Mirakl call from worker
- Bob trace: Story 1.2 (envelope encryption helpers + master-key loader + secret-scanning hook); customer-facing key-entry form + encryption pipeline lands in Epic 4 (Story 4.3 — onboarding key entry), NOT Story 1.3; Story 1.3 owns pino redaction (per AD27)

### AD4 — Founder admin access via service-role bypass + role flag, never customer impersonation
- `founder_admins` table holds rows for elevated users
- `/admin/*` routes verify requesting user's email is in `founder_admins` AND uses service-role DB connection server-side only
- Customer-facing audit log UI reused at `/audit?as_admin={customer_id}` with red admin-mode banner; no separate UI built
- Founder NEVER logs in as customer impersonator at MVP — all admin queries read-only
- Why: FR6, FR47, NFR-O3; UX skeleton §UX28–UX30 specify read-only posture and reuse pattern
- Affects: `/admin/status` page composition; audit-log query shape; service-role-key access pattern
- Bob trace: Story 1.5 (`founder_admins` table + seed migration + admin-route middleware checking email membership); Story 8.10 (admin status page UI reusing customer-facing audit log with `?as_admin=` parameter)

## B. Mirakl Integration

### AD5 — Mirakl HTTP client reused from DynamicPriceIdea, adapted for multi-tenant
- `shared/mirakl/api-client.js` forked from DynamicPriceIdea's `src/workers/mirakl/apiClient.js`
- Auth header: raw `Authorization: <api_key>` (NO Bearer prefix). [Empirical: confirmed on all 6 Worten calls in verification run]
- Retry schedule: 5 retries, exponential backoff `[1s, 2s, 4s, 8s, 16s]`; retryable on 429 + 5xx + transport errors; non-retryable on 4xx (except 429); max attempt cap 30s per delay
- Error classification: `MiraklApiError` carries `status` (HTTP status code; 0 for transport); `getSafeErrorMessage(err)` returns PT-localized customer-facing strings; raw error text never reaches customer
- Adaptation: `apiKey` is function parameter, never module-scope; worker decrypts customer key at cycle start, passes through `mirAklGet(...)`, never logs it
- Why: production-tested code; covers retry/backoff per NFR-I1; safety constraint that error responses don't leak operator-side detail (NFR-S1 trust posture)
- Affects: every Mirakl call (P11, OF21, A01, PC01, PRI01, PRI02, PRI03)
- Bob trace: Story 3.1 (port `apiClient.js` + tests + JSDoc annotation)

### AD6 — Per-channel pricing model: channel_pricing_mode enum on customer_marketplace; Worten = SINGLE at MVP
- Schema column `customer_marketplace.channel_pricing_mode` enum: `'SINGLE' | 'MULTI' | 'DISABLED'`; captured from PC01 at onboarding; persisted; checked at engine dispatch
- Worten: value is `'SINGLE'`. [Empirical: PC01 returned `channel_pricing: SINGLE`]; engine writes one price per (SKU, channel); MULTI's tiered pricing capability unused
- DISABLED operators (future): schema collapses to one price per SKU; engine ignores channel dimension; PT/ES toggle becomes vestigial; detected at onboarding and routed to different code path
- Engine reasons per-(SKU, channel) regardless of mode; schema row is `sku_channel(customer_marketplace_id, sku_id, channel_code, ...)`; for DISABLED, only one channel_code (`'DEFAULT'`) row per SKU exists
- Why: FR25 (per-channel repricing for Worten PT vs ES); MCP-documented PC01 enum [MCP: PC01 features.pricing.channel_pricing]; empirical Worten value [Empirical: PC01]; schema reservation for Epic 2 multi-marketplace
- Affects: every per-(SKU, channel) operation; engine dispatch; dashboard PT/ES toggle (UX skeleton UX14); audit-log per-channel filtering
- Bob trace: Story 4.1 (PC01 onboarding capture + channel_pricing_mode persistence + engine dispatch branching)

### AD7 — PRI01 writer: per-SKU aggregation, delete-and-replace semantic, pending_import_id atomicity
- PRI01 CSV writer is per-SKU operation, even though engine reasons per-(SKU, channel)
- 9-point semantic:
  1. Write boundary is per-SKU. When engine flags any (SKU, channel) for write in cycle N, writer loads ALL `sku_channel` rows for that SKU's `customer_marketplace_id`, builds CSV with one line per active channel (updated channels carry new price; untouched channels pass through `last_set_price` so they're not deleted), submits full SKU's price set. [MCP: PRI01 — "import mode is delete and replace; any existing price that is not submitted will be deleted."]
  2. CSV column set (Worten MVP): `offer-sku;price;channels` only. NO discount-start-date / discount-end-date / start-date / end-date / price-ranges columns. [Empirical: PC01 returned `discount_period_required: false`, `scheduled_pricing: false`, `volume_pricing: false`]
  3. Delimiter: `;` (semicolon). [Empirical: PC01 returned `operator_csv_delimiter: SEMICOLON`]; captured per-marketplace in `customer_marketplace.operator_csv_delimiter` so writer reads live value, never hardcoded default
  4. Decimal precision: 2 decimals. [Empirical: PC01 returned `offer_prices_decimals: "2"`]; persisted in `customer_marketplace.offer_prices_decimals`
  5. Decimal separator: ASCII period (`.`) per CSV standard. [UNVERIFIED for Worten — calibrate empirically during dogfood; verification-results.json did not exercise PRI01 since writes are forbidden]; if dogfood reveals comma, writer reads from per-marketplace config column
  6. `channels` column format: pipe-separated channel codes (e.g., `WRT_PT_ONLINE|WRT_ES_ONLINE`) for channels the line applies to; empty for default-channel pricing; for Worten SINGLE mode, every line carries its specific channel code. [MCP: PRI01 examples — Channel Pricing pattern]
  7. `shop_sku` is value in `offer-sku` column; seller-provided SKU (e.g., `EZ8809606851663`) is what Mirakl maps line back to internally. [Empirical: OF21 returned `shop_sku: "EZ8809606851663"` for test offer; `offer_sku: null`; `product_sku` is Mirakl's internal UUID, NOT seller SKU]
  8. Pending-import atomicity: at moment of submitting PRI01 batch, EVERY `sku_channel` row participating in batch (including channel rows whose price isn't changing — appear as passthrough lines) gets `pending_import_id = <import_uuid>` set; makes cooperative-absorption "skip-on-pending" predicate work correctly during in-flight imports; PRI02 COMPLETE clears `pending_import_id` for all rows in batch atomically; PRI02 FAILED clears `pending_import_id` AND triggers per-SKU error handling per AD24
  9. Recovery from PRI03 partial failures is per-SKU resubmit. When PRI03 reports SKU001 line N failed, writer DOES NOT resubmit just line N — rebuilds SKU001's full multi-channel set with corrected line and resubmits whole SKU
- Why: FR23 (PRI01-only writes, PRI02 polling, PRI01 partial-success handling); MCP-documented per-SKU delete-and-replace [MCP: PRI01]; empirical Worten CSV/delimiter/decimal config [Empirical: PC01]; cooperative-ERP-sync race-condition resolution from pre-locked decisions
- Affects: every PRI01 emission; `sku_channel` schema (`pending_import_id`, `pending_set_price` columns); cooperative-absorption logic; PRI03 retry path
- Bob trace: Story 6.1 (PRI01 CSV writer + per-marketplace config consumption + pending_import_id atomicity); Story 6.2 (PRI02 poller + COMPLETE/FAILED handling); Story 6.3 (PRI03 error report parser + per-SKU rebuild + retry)

### AD8 — Engine decision table (the PRD gap, fully enumerated)
- Closes PRD gap where FR24 references "documented decision-table cases" but never enumerates them; binding spec for engine's per-(SKU, channel) decision per cycle
- INPUTS: `ean` (SKU's EAN); `channel` (e.g., `'WRT_PT_ONLINE'`); `list_price` (engine's anchor); `current_price` (last-known own price on this channel from P11 read); `last_set_price` (last price successfully pushed, post PRI02 COMPLETE); `max_discount_pct`, `max_increase_pct` (customer's tolerance bands, per-marketplace at MVP); `edge_step_cents = 1` (MVP default; per-marketplace config column for Epic 2); `own_shop_name` (`customer_marketplace.shop_name` from A01); `anomaly_threshold_pct = 0.40` (MVP default; per-marketplace config column for Epic 2)
- PRECONDITIONS (all must hold; if any false, SKIP this SKU this cycle): `customer_marketplace.cron_state = 'ACTIVE'`; `sku_channel.frozen_for_anomaly_review = false`; `sku_channel.pending_import_id IS NULL` (AD7 atomicity); `sku_channel.excluded_at IS NULL` (Epic 2 reservation)
- STEP 1 — read competitor data via P11 for (ean, channel): `P11(product_references=EAN|<ean>, channel_codes=<channel>, pricing_channel_code=<channel>)`; filter offers: `o.active === true AND o.total_price > 0` (MANDATORY, AD14); filter offers: `o.shop_name !== own_shop_name` (defensive self-filter, AD13); rank ascending by `total_price` (Mirakl default; verify explicitly); if no remaining offers: tier = 3, no write, audit_log: `'tier-transition'` (Rotina)
- STEP 2 — cooperative-ERP-sync detection (AD9): if `current_price != last_set_price` (and `pending_import_id IS NULL`): `deviation_pct = abs((current_price - list_price) / list_price)`; if `deviation_pct > anomaly_threshold_pct`: `sku_channel.frozen_for_anomaly_review = true`; audit_log: `'anomaly-freeze'` (Atenção, FR29); Resend critical alert (FR48); return HOLD (no write); else: `sku_channel.list_price = current_price` (absorb as new baseline); audit_log: `'external-change-absorbed'` (Notável)
- STEP 3 — compute floor and ceiling (rounded conservatively to `offer_prices_decimals`): `floor_price = ROUND_UP(list_price * (1 - max_discount_pct), decimals)`; `ceiling_price = ROUND_DOWN(list_price * (1 + max_increase_pct), decimals)`; ROUND_UP for floor (never below raw floor); ROUND_DOWN for ceiling (never above raw ceiling)
- STEP 4 — branching by position: `competitor_lowest = ranked[0].total_price`; `competitor_2nd = ranked[1]?.total_price ?? null`; position = our rank in {ranked + own offer at current_price+min_shipping}
- STEP 4 CASE A — position > 1 (we're contested): `target_undercut_price = competitor_lowest - (edge_step_cents / 100)`; `candidate_price = MAX(target_undercut_price, floor_price)`; if `candidate_price < competitor_lowest`: action = UNDERCUT, new_price = candidate_price, audit_log: `'undercut-decision'` (Rotina); else: action = HOLD (can't undercut profitably), audit_log: `'hold-floor-bound'` (Rotina)
- STEP 4 CASE B — position == 1 (we're winning; ceiling-raise logic): if `competitor_2nd is null`: action = HOLD (no 2nd-place target), audit_log: `'hold-already-in-1st'` (Rotina); else: `target_ceiling_price = competitor_2nd - (edge_step_cents / 100)`; `new_ceiling_price = MIN(target_ceiling_price, ceiling_price)`; if `new_ceiling_price > current_price`: action = CEILING_RAISE, new_price = new_ceiling_price, audit_log: `'ceiling-raise-decision'` (Rotina); else: action = HOLD, audit_log: `'hold-already-in-1st'` (Rotina)
- STEP 5 — circuit breaker check (per-SKU 15% cap, AD11): if action ∈ {UNDERCUT, CEILING_RAISE}: `delta_pct = abs(new_price - current_price) / current_price`; if `delta_pct > 0.15`: action = HOLD_CIRCUIT_BREAKER_PER_SKU, audit_log: `'circuit-breaker-per-sku-trip'` (Atenção), Resend critical alert; per-cycle 20% catalog cap is enforced at dispatcher (AD11), not here
- STEP 6 — emit to PRI01 batch: if action ∈ {UNDERCUT, CEILING_RAISE}: `sku_channel.pending_set_price = new_price`; add (SKU, channel, new_price) to current cycle's `pri01_staging` table
- PRI01 writer (AD7) consumes staging table per-SKU: groups by SKU; loads ALL `sku_channel` rows for each SKU; emits CSV with all channels (updated + passthrough); sets `pending_import_id` on all involved rows; submits one PRI01 per SKU-batch
- Tie handling (explicit): when `candidate_price == competitor_lowest` (CASE A) or `new_ceiling_price <= current_price` (CASE B), action is HOLD; Worten's tiebreaker unknown (likely shop quality, premium status, age, or random); pushing into tie is coin-flip with margin sacrifice; HOLD is strictly better. [Pre-locked decision per engine-undercut conversation]
- Edge cases enumerated:
  - Leader-is-self: after self-filter (AD13), our offer is not in `ranked[]`; we read our own position from separate count; if unfiltered P11 ranking placed us at position 1, we enter CASE B; if our own offer missing from unfiltered ranking entirely (e.g., we're inactive on this channel), we enter CASE A as if we never participated
  - All competitors above ceiling: position 1 already (we're cheapest); CASE B with `target_ceiling_price` capped at `ceiling_price` produces HOLD or small raise within tolerance; never a write that violates ceiling
  - Two-repricer-conflict: Tier 2a's 15-min cadence (AD10) catches re-undercuts within ~15 min; equilibrium converges to floor when both repricers configure tight `edge_step`; customer-tunable response (e.g., back off, accept loss) deferred to Epic 2
  - Single-channel offer: if SKU listed only on PT, only PT `sku_channel` row exists; engine never queries P11 for ES on that SKU; writer's per-SKU aggregation (AD7) emits only PT channel line
  - Single-competitor: CASE A or CASE B with `competitor_2nd is null`; already enumerated
- Why: FR21–FR25 (engine logic), FR24 (decision-table cases); pre-locked engine logic
- Affects: entire engine; every audit-log event-type emission; `pending_set_price` / `last_set_price` state machine
- Bob trace: Story 7.1 (engine decision table + unit tests covering every CASE + edge case); Story 7.2 (cooperative-absorption logic); Story 7.3 (anomaly-freeze trigger)

### AD9 — Cooperative-ERP-sync absorption: PRI02-gated last_set_price, skip-on-pending
- Mechanic: each cycle, compare `current_price` (read from P11) against `last_set_price` (last value PRI02-confirmed); if different AND `pending_import_id IS NULL`, change is external — update `list_price = current_price`, recompute floor/ceiling, continue normal repricing
- PRI02 gate: `last_set_price` only updates after PRI02 returns COMPLETE for `import_id` that wrote it; while `pending_import_id IS NOT NULL` for any (SKU, channel) row, cooperative-absorption SKIPS that row entirely — row's `current_price` presumed in flux, not stable signal
- Anomaly threshold: if `abs((current_price - list_price) / list_price) > anomaly_threshold_pct` (default 0.40, per-marketplace config column reserved for Epic 2 customization), SKU is FROZEN per AD8 STEP 2; customer review/confirm/reject unfreezes via modal in UX skeleton §9.2
- Audit: every absorption fires `external-change-absorbed` Notável event (FR38d); every freeze fires `anomaly-freeze` Atenção event (FR29)
- Why: FR22 (cooperative-absorption mechanic), FR29 (anomaly freeze), pre-locked decision (PRI01/PRI02 race resolution via `pending_import_id`)
- Affects: engine STEP 2 logic; `sku_channel` schema; audit-log event-type taxonomy
- Bob trace: Story 7.2 (cooperative-absorption + skip-on-pending unit tests); Story 7.3 (anomaly-freeze + `frozen_for_anomaly_review` state); Story 8.x (anomaly-review modal + accept/reject UI)

### AD10 — 4-state tier system + per-SKU tier_cadence_minutes + last_won_at
- Tier states:
  - Tier 1 (contested, position > 1): `tier_cadence_minutes = 15`
  - Tier 2a (winning, position = 1, `last_won_at < 4h ago`): `tier_cadence_minutes = 15`
  - Tier 2b (stable winner, position = 1, `last_won_at >= 4h ago`): `tier_cadence_minutes = 45` (lock value at midpoint of PRD's 30–60 range; calibratable from dogfood)
  - Tier 3 (no competitors): `tier_cadence_minutes = 1440` (daily; doubles as nightly reconciliation per FR28)
- Transitions (per FR19):
  - T1 → T2a on winning 1st: set `last_won_at = NOW()`, `tier_cadence_minutes = 15`
  - T2a → T2b after 4h elapsed since `last_won_at`: engine detects on next cycle and writes `tier = '2b'`, `tier_cadence_minutes = 45` (atomic with cycle's `tier-transition` audit event); until that next cycle runs, row continues at T2a's 15-min cadence — acceptable transient overshoot of one extra check; without write-back, dispatcher predicate (`last_checked_at + tier_cadence_minutes < NOW()`) would keep row at 15 min forever, defeating Tier 2b's API-economy purpose (F1 fix)
  - {T2, T2a, T2b} → T1 on losing 1st: `tier_cadence_minutes = 15`; `last_won_at` preserved (analytics)
  - T3 → T1/T2a on new competitor entering: if already at 1st AND beats new competitor → T2a; else → T1
- Schema: `sku_channel.tier_cadence_minutes` (integer); `sku_channel.last_won_at` (timestamptz nullable); `sku_channel.last_checked_at` (timestamptz NOT NULL); `sku_channel.tier` (enum `'1' | '2a' | '2b' | '3'`)
- Per-customer override (Epic 2): `customer_marketplace.tier_cadence_minutes_override` JSONB or per-tier columns, NULL at MVP; when non-NULL, used in place of defaults
- Why: FR17–FR19 (4-state spec); pre-locked decision (Tier 2b = 45 min); 100k+ SKU cadence-relaxation pathway
- Affects: dispatcher SKU-selection query; tier-transition logic; KPI computation ("SKUs in 1st place" = `COUNT WHERE tier IN {2a, 2b}`; "losing position" = `COUNT WHERE tier = 1`; "exclusive" = `COUNT WHERE tier = 3`)
- Bob trace: Story 7.4 (tier classification + transitions + per-SKU `cadence_minutes` column)

### AD11 — Outbound circuit breaker: per-cycle 20% + per-SKU 15%
- Per-SKU cap (15%): enforced at engine STEP 5 per AD8 (after `candidate_price` computation, before staging); trip = HOLD + Atenção event + Resend alert
- Per-cycle cap (20%): enforced at **dispatcher** before staging is flushed to PRI01; after all per-SKU decisions computed for cycle:
  - Numerator = `COUNT(*) FROM pri01_staging WHERE cycle_id = <current> AND flushed_at IS NULL` (rows staged for write this cycle)
  - Denominator = `COUNT(*) FROM sku_channels WHERE customer_marketplace_id = <current> AND excluded_at IS NULL` (active SKUs in marketplace)
  - Trip predicate: `numerator / denominator > 0.20`
  - Denominator is marketplace's full active-SKU count, NOT cycle's scheduled set (which is small slice and would trigger constantly) — F6 made explicit
- On trip, dispatcher: 1. Halts staging flush (no PRI01 emitted this cycle); 2. Sets `customer_marketplace.cron_state = 'PAUSED_BY_CIRCUIT_BREAKER'`; 3. Emits `circuit-breaker-trip` Atenção event with affected-SKU list; 4. Sends Resend critical alert (FR48); 5. Surfaces customer-facing dashboard banner (UX skeleton §9.8)
- Manual unblock: customer reviews via audit log (UX skeleton §2.2 flow), clicks "Retomar manualmente" — sets `cron_state = 'ACTIVE'`; next cycle's per-SKU decisions recomputed from current state (no pending writes survive circuit-breaker trip)
- Why: FR26, FR27; PRD's 4-layer safety stack
- Affects: dispatcher logic; `cron_state` machine; audit-log + banner UX
- Bob trace: Story 7.5 (circuit breaker — both caps + manual unblock)

### AD12 — Inbound anomaly freeze (>40% external deviation) → per-SKU frozen_for_anomaly_review
- Already specified in AD9 STEP 2; freeze is per-SKU (not per-customer) — orthogonal to `cron_state`; customer reviews via modal (UX skeleton §9.2), confirms (`list_price = new_value`, unfreeze) or rejects (`list_price` unchanged, unfreeze)
- TBD — frozen-state semantic-overload (Story 6.3 sharding decision): Story 6.3 (PRI03 escalation per AD24) introduces a second per-SKU freeze reason: 3-consecutive-cycles PRI01 failures escalate the SKU into a freeze pending review. Two viable representations, equivalent in customer UX, divergent in schema:
  - Option (a) — `frozen_reason` enum discriminator: replace boolean `sku_channels.frozen_for_anomaly_review` with `sku_channels.frozen_reason text` (NULL = unfrozen; non-NULL = frozen with reason); reasons: `'ANOMALY_REVIEW' | 'PRI01_PERSISTENT_FAILURE'`; engine SKIPs any non-NULL row; pros: single freeze field, extensible if future freeze reasons emerge, review modal can switch on reason for tailored copy; cons: data-migration on column rename (forward-only per Step 5); ESLint rule `no-frozen-bool` enforces nobody reads legacy field
  - Option (b) — parallel `frozen_for_pri01_persistent` boolean: add `sku_channels.frozen_for_pri01_persistent boolean NOT NULL DEFAULT false` alongside `frozen_for_anomaly_review`; engine dispatcher predicate adds `AND frozen_for_pri01_persistent = false` to existing skip-condition chain; pros: zero migration on existing column, predicate change is additive; cons: review-modal logic branches on two booleans, future freeze reasons each add another column (linear growth not enum-extensible)
- Bob picks during Story 6.3 sharding. **Architecture-doc obligation post-pick**: whoever shards Story 6.3 updates this AD12 trailing note (replace TBD block with chosen option's locked spec) AND `sku_channels` DDL in §Database Schema (replace corresponding column comment with chosen representation) AND dispatcher predicate in AD17. Both options preserve "freeze is orthogonal to cron_state" invariant; both options preserve customer-review-modal as unfreeze path
- Why: FR29; pre-locked decision (`frozen_for_anomaly_review` orthogonal to `cron_state` enum)
- Affects: engine STEP 2; `sku_channel` schema; anomaly-review modal flow
- Bob trace: Story 7.3 (anomaly-freeze trigger); Story 8.x (review modal + accept/reject endpoints); Story 6.3 (frozen-state representation decision per TBD note above)

### AD13 — Self-identification via defensive shop_name filter
- Capture: A01 at onboarding returns `shop_id` and `shop_name`; both persist on `customer_marketplace`. [Empirical: A01 returned `shop_id: 19706, shop_name: "Easy - Store"` for test account]
- Filter: every P11 response post-processed to remove offers where `offer.shop_name === customer_marketplace.shop_name` BEFORE ranking; `shop_id` is null in P11 competitor offers, so cannot be primary key. [Empirical: all 30 P11 competitor offers across 3 verification calls returned `shop_id: null`]
- Defensive collision check: if more than one offer in P11 response matches our `shop_name`, emit `shop-name-collision-detected` Atenção audit event AND skip SKU for cycle (don't trust ranking under collision); Worten almost certainly enforces shop_name uniqueness, but this guards against future Mirakl change
- Why both false empirically? [Empirical: Easy-Store's offer is `active: false` (zero quantity); P11's default `all_offers=false` excludes inactive offers, so our offer didn't appear in either PT or ES P11 responses]; INCONCLUSIVE for whether Mirakl auto-excludes active-self; defensive filter handles either reality
- Why: PRD §Mirakl Integration Patterns + engine "leader-is-self" decision-table case (AD8); empirical confirmation that `shop_id` is null in P11 [Empirical]
- Affects: every P11 read in engine
- Bob trace: Story 7.6 (self-filter + collision-detection unit tests)

### AD14 — Mandatory P11 offer filter: active === true AND total_price > 0
- Both filters non-optional for engine
- `offer.active === true` — P11 may return inactive offers despite `all_offers=false` default; post-fetch filter is safety net. [MCP: P11 — `inactivity_reasons` enum includes `SHOP_NOT_OPEN`, `ZERO_QUANTITY`]; DynamicPriceIdea's production code uses this filter
- `offer.total_price > 0` — Worten returns placeholder offers with `total_price = 0` mixed in among real offers in production. [Empirical: Strawberrynet returned at rank 0 with `total_price: 0, price: 0` in verification run's PT and ES P11 calls]; without this filter, engine would chase phantom €0 floor target on every cycle
- Filter chain at engine STEP 1:
  ```
  offers
    .filter(o => o.active === true)
    .filter(o => Number.isFinite(o.total_price) && o.total_price > 0)
    .filter(o => o.shop_name !== own_shop_name)
    .sort((a, b) => a.total_price - b.total_price)
  ```
- Why: FR20 (P11 ranking), FR23 (decision-table); empirical confirmation of `total_price = 0` placeholders in production [Empirical]
- Affects: engine STEP 1 (every cycle); P11 batch-scanner reused from DynamicPriceIdea (already implements this)
- Bob trace: Story 7.1 (engine STEP 1 + filter chain unit tests with fixture data including `total_price=0` competitor)

## C. Cron Architecture & State Machine

### AD15 — cron_state enum on customer_marketplace; per-SKU frozen_for_anomaly_review orthogonal
- `customer_marketplace.cron_state` enum values (all 8):
  - `'PROVISIONING'` — F4: row exists, onboarding scan in progress (A01 + PC01 + OF21 + P11); A01/PC01 columns populating; CHECK constraint blocks transition out until all populated; engine SKIPS rows in this state
  - `'DRY_RUN'` — scan complete; engine simulates; audit log shows "would-have-done" events; no PRI01
  - `'ACTIVE'` — live cron running
  - `'PAUSED_BY_CUSTOMER'` — FR32 (customer clicked pause)
  - `'PAUSED_BY_PAYMENT_FAILURE'` — FR43 (Stripe sub auto-cancelled)
  - `'PAUSED_BY_CIRCUIT_BREAKER'` — FR27 (cycle halted, awaiting manual unblock)
  - `'PAUSED_BY_KEY_REVOKED'` — UX skeleton §8.1 (Worten 401 detected)
  - `'PAUSED_BY_ACCOUNT_GRACE_PERIOD'` — FR4 amended (deletion initiated, 7-day grace)
- Dispatcher predicate: `WHERE cron_state = 'ACTIVE' AND last_checked_at + tier_cadence_minutes < NOW()` (clean predicate, no NOT clauses)
- Per-SKU `frozen_for_anomaly_review` is separate boolean column on `sku_channel`; orthogonal to `cron_state`; engine SKIPS SKU regardless of `cron_state`
- Banner UX precedence (UX skeleton UX4) is natural priority order of enum: 1. payment_failure > 2. circuit_breaker > 3. anomaly (per-SKU, banner shows count) > 4. key_revoked > 5. account_grace_period > 6. paused_by_customer > 7. provisioning > 8. dry_run
- F4 precedence note: PROVISIONING slots between paused_by_customer and dry_run; UX-wise, customer redirected to `/onboarding/scan` during this state (UX skeleton §3.3); banner is defensive fallback if they navigate elsewhere ("Catálogo a ser carregado…"); engine SKIPS PROVISIONING rows (dispatcher predicate `WHERE cron_state = 'ACTIVE'` already excludes them)
- Why: pre-locked decision (single enum); UX skeleton UX4–UX5 (distinct visual treatments per paused reason); FR27, FR32, FR43, FR4 amended
- Affects: dispatcher SQL; banner rendering; audit-log filtering by state; deletion-grace and key-revocation interception flows
- Bob trace: Story 4.2 (cron_state schema + transitions); Story 8.x per state (pause/resume customer; circuit breaker unblock; anomaly review; key-revoked rotation flow; account-deletion grace)

### AD16 — Onboarding scan sequence: key-validate → A01 → PC01 → OF21 → P11 → tier-classify → baseline
- Locked sequence, all gating prefix steps before customer reaches dashboard:
  1. Key validation — single P11 call against known-good test EAN; if 401/403, surface inline error per UX skeleton §3.2; do NOT persist key
  2. A01 (`GET /api/account`) — capture `shop_id`, `shop_name`, `channels[]`, `currency_iso_code`, `state`, `is_professional`, `domains[]`; persist on `customer_marketplace`
  3. PC01 (`GET /api/platform/configuration`) — capture `channel_pricing` (assert ∈ {SINGLE, MULTI}; abort onboarding with PT-localized error if DISABLED), `operator_csv_delimiter`, `offer_prices_decimals`, `discount_period_required`, `competitive_pricing_tool`, `scheduled_pricing`, `volume_pricing`, `multi_currency`, `order_tax_mode`; persist as columns AND as JSONB snapshot in `customer_marketplace.platform_features_snapshot` for audit/diagnostic
  4. OF21 (`GET /api/offers` paginated) — read own catalog; capture `shop_sku`, `product_sku`, `ean`, `quantity`, `price`, `total_price`, `min_shipping_price`, `channels[]`, `active`; bulk-load into `sku_channel` rows (one per (SKU, channel) the offer is sellable on)
  5. P11 batch scan (per AD5) — for each EAN, batch 100 EANs per call, 2 calls per batch (one per channel); filter `active=true AND total_price>0 AND shop_name !== own_shop_name`; read top-2 offers per (SKU, channel); persist competitor snapshot
  6. Tier classification — assign each `sku_channel` row to T1 / T2a / T2b / T3 per AD10 transition rules; set `tier_cadence_minutes` accordingly; set `last_won_at = NOW()` for SKUs already at position 1
  7. Baseline snapshot — copy `current_price` → `list_price` for every `sku_channel`; persist separate `baseline_snapshot` row per (SKU, channel) for Epic 2 "restore baseline" feature
- Customer lands on `/onboarding/scan-ready` (UX skeleton §8.3) once scan completes; `/onboarding/margin` follows
- Pass-2 UX delta for Sally: existing 4-phase progress (UX skeleton §3.3) needs either prepended "Configurando integração com Worten" phase (covering A01 + PC01) or 6-phase rename; non-blocking; tracked
- Smoke-test reuse: `scripts/mirakl-empirical-verify.js` runs same A01 + PC01 + OF21 + P11 calls and asserts prerequisites; at first-customer onboarding, Bob's Story 1.X runs this script with customer's freshly-validated key BEFORE proceeding with OF21 catalog import — fail-loudly if assertion block has any false
- Why: FR12–FR16 (catalog scan), FR8–FR11 (key entry), empirical-verification mandate; A01 + PC01 emerged as load-bearing during MCP/empirical work
- Affects: entire onboarding state machine; `customer_marketplace` schema columns; scan-progress UI phase definition
- Bob trace: Story 4.x (onboarding scan orchestration); Story 1.X (Mirakl integration smoke test reusing `scripts/mirakl-empirical-verify.js`)

### AD17 — Dispatcher: master 5-min cron + per-customer Postgres advisory locks
- Master cron runs every 5 minutes inside worker process via `node-cron`
- Dispatch query (verbatim):
  ```sql
  SELECT cm.id, sc.id, sc.sku_id, sc.channel_code
  FROM customer_marketplace cm
  JOIN sku_channel sc ON sc.customer_marketplace_id = cm.id
  WHERE cm.cron_state = 'ACTIVE'
    AND sc.frozen_for_anomaly_review = false
    AND sc.pending_import_id IS NULL
    AND sc.excluded_at IS NULL
    AND sc.last_checked_at + (sc.tier_cadence_minutes * INTERVAL '1 minute') < NOW()
  ORDER BY cm.id, sc.last_checked_at ASC
  LIMIT <batch_size>;
  ```
- Per-customer parallelism via advisory locks: before processing any SKU for a customer, dispatcher calls `pg_try_advisory_lock(<customer_marketplace_id>)`; if lock held by another worker, skip that customer's SKUs this tick — different customers can be processed in parallel by multiple workers without coordination overhead
- At MVP scale (5–10 customers, single worker), lock is essentially uncontended; architectural invariant supports horizontal scaling per NFR-Sc3 without rework
- Stale-lock handling: advisory locks are session-scoped; worker crash releases them automatically (Postgres handles); no stale-lock cleanup logic needed (unlike table-row pseudo-mutex pattern in Gabriel's project)
- Cycle assembly: within customer's lock session, dispatcher groups SKUs by tier, runs engine decisions per AD8, stages writes to per-cycle `pri01_staging` table, runs per-cycle 20% circuit-breaker check (AD11), then flushes staging to PRI01 writer (AD7)
- Why: FR18 (single cron + per-SKU cadence), NFR-Sc3 (advisory-lock-or-similar); cleaner model than Gabriel's table-row pseudo-mutex
- Affects: dispatcher logic; horizontal-scale story (Epic 2 second worker just runs same code with no coordination changes)
- Bob trace: Story 5.1 (master cron + dispatcher + advisory-lock per-customer); Story 5.2 (cycle assembly + staging table flush)

### AD18 — Polling-only architecture; no webhooks (seller-side unavailable)
- [MCP: "Webhooks & Cloud Events are only available for Operator users, not for Seller users."] Locked
- All Mirakl-side change detection via P11 read each cycle; cooperative-absorption is purely cycle-based
- Internal Stripe webhooks (subscription state changes) ARE used and NOT affected — they're inbound to MarketPilot, not from Mirakl
- Why: MCP-confirmed seller-side webhooks unavailable; pre-locked decision
- Affects: every external-change detection in engine; rules out push-driven optimization in Epic 2 unless Mirakl changes policy

## D. Audit Log Architecture

### AD19 — Monthly partitioning + compound indexes + precomputed aggregates
- Volume: ~3M entries/quarter/customer at production catalog scale; on-demand computation against multi-million-row tables blows NFR-P8 2s budget on 90-day window
- `audit_log` partitioned by `created_at` MONTH via Postgres native declarative partitioning; per-month tables (`audit_log_2026_05`, etc.); monthly cron creates partitions; partitions >90d for Notável/Rotina detached/archived; Atenção retained per customer-account lifetime (NFR-S6)
- Compound indexes: `(customer_marketplace_id, created_at DESC)` primary; `(customer_marketplace_id, sku_id, created_at DESC)` search-by-SKU; `(customer_marketplace_id, event_type, created_at DESC)` feed filter; `(customer_marketplace_id, channel_code, created_at DESC)` channel filter; `(customer_marketplace_id, cycle_id, sku_id)` firehose drill-down
- Precomputed aggregate `daily_kpi_snapshots` (one row per `customer_marketplace_id`, `channel_code`, `date`): counts of position_won, position_lost, anomaly_freeze, external_change_absorbed, undercut, ceiling_raise, hold; total catalog value in 1st place; total at risk; refreshed midnight daily cron + partial-incremental every 5 min for today
- Precomputed aggregate `cycle_summaries` (one row per `customer_marketplace_id`, `cycle_id`): aggregate counts (undercuts, raises, holds, failures), median price delta, affected SKU count; written at cycle-end by dispatcher
- Query→UX surface mapping: daily summary card (§4.1.1) → `daily_kpi_snapshots` today JOIN yesterday delta; Atenção feed (§4.1.2) → `audit_log` filter `event_type IN (atenção_set) AND resolved_at IS NULL` last 30d ORDER BY `created_at` DESC LIMIT 50; Notável feed (§4.1.3) → filter `event_type IN (notável_set)` last 30d LIMIT 30; search-by-SKU (§4.1.4) → filter `(customer_marketplace_id, sku_id)` last 90d no event_type filter; firehose (§4.1.5) → `cycle_summaries` paginated 50/page, SKU expansion lazy-loads from `audit_log` filtered `(customer_marketplace_id, cycle_id)`
- Why: NFR-S6 (append-only at app layer); NFR-P8 (≤2s on 90-day window); UX skeleton §4.1 5-surface IA + volume-math justification
- Affects: entire schema and query layer for dashboard audit-log surfaces; precomputed-aggregate refresh jobs
- Bob trace: Story 9.1 (audit_log schema + monthly partition automation); Story 9.2 (`daily_kpi_snapshots` + `cycle_summaries` + refresh jobs); Story 9.3 (5-surface query endpoints with HTMX-ready URL conventions)

### AD20 — Audit log event-type taxonomy locked from UX skeleton §4.1.6
- Three priority levels enforce default UI surfacing (FR38d); counts spec-load-bearing; future event_type addition extends one of three lists AND `audit_log_event_types` row AND `EVENT_TYPES` constant in `shared/audit/event-types.js`
- Base seed 26 event_types (Story 9.0 lookup-table seed):
- Atenção (7): `anomaly-freeze`, `circuit-breaker-trip`, `circuit-breaker-per-sku-trip`, `key-validation-fail`, `pri01-fail-persistent`, `payment-failure-pause`, `shop-name-collision-detected` (added per AD13)
- Notável (8): `external-change-absorbed`, `position-won`, `position-lost`, `new-competitor-entered`, `large-price-move-within-tolerance`, `customer-paused`, `customer-resumed`, `scan-complete-with-issues`
- Rotina (11): `undercut-decision`, `ceiling-raise-decision`, `hold-floor-bound`, `hold-ceiling-bound`, `hold-already-in-1st`, `cycle-start`, `cycle-end`, `pri01-submit`, `pri02-complete`, `pri02-failed-transient`, `tier-transition`
- Epic 12 additions (+2 Atenção): `cycle-fail-sustained` (Story 12.1) — emitted by 3-tier failure classifier after 3 consecutive cycles fail to reach Mirakl for same customer (per AD24); `platform-features-changed` (Story 12.3) — emitted by monthly PC01 re-pull cron when response differs from persisted snapshot (per AD26)
- **Total at end of MVP: 28 event_types** = 9 Atenção (7 base + 2 Epic 12) + 8 Notável + 11 Rotina
- Schema: `audit_log.event_type` is `text` referencing `audit_log_event_types(event_type)` lookup table per F5 (NOT Postgres enum — lookup table allows row-by-row priority assertion via trigger AND avoids `ALTER TYPE ... ADD VALUE` migration friction when 12.1+12.3 add event_types); `audit_log.priority` denormalized via BEFORE-INSERT trigger `audit_log_set_priority` reading lookup-table priority and stamping the row
- Test-count assertion canonical pattern: Story 9.0 integration tests MUST assert `EVENT_TYPES.length === <expected>` (NOT hardcoded 26 or 28); `EVENT_TYPES` constant in `shared/audit/event-types.js` is single source of truth; Stories 12.1 + 12.3 each extend constant in same PR adding lookup-table seed row; canonical pattern for any future event_type addition — never hardcode the count
- Decided 2026-04-30 (Q2): NO 29th `account-deletion-initiated` event_type at MVP; total stays at 28; rationale: email trail (deletion-confirmation + deletion-grace-reminder + deletion-final per Stories 10.1+12.2) is canonical record for account-lifecycle; `audit_log` scope restricted to engine + operational events; `audit_log` rows wiped at T+7d hard-delete (AD21) so logging deletion-initiation would self-erase; Story 10.1 `transitionCronState(<current> → PAUSED_BY_ACCOUNT_GRACE_PERIOD)` emits NO audit event by passing `eventType: null` (helper accepts null for non-engine state changes)
- Why: UX skeleton §4.1.6 + FR38d (locked taxonomy); F5 (lookup-table over Postgres enum); Story 9.0 calendar-early ordering for audit-as-trust artifact
- Bob trace: Story 9.0 (lookup table + 26-row seed + EVENT_TYPES constant + integration test asserting `EVENT_TYPES.length`); Story 12.1 extends seed +1 (`cycle-fail-sustained`); Story 12.3 extends seed +1 (`platform-features-changed`)
