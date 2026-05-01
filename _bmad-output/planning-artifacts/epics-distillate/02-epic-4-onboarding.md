---
type: bmad-distillate-section
sources:
  - "../epics.md"
parent: "_index.md"
part: 2
of: 8
---

This section covers Epic 4 Customer Onboarding (Stories 4.1–4.9) — 9 stories. Part 2 of 8 from epics.md.

## Epic 4: Customer Onboarding

**Goal.** Signed-up customer pastes their Worten Mirakl shop API key, sees inline 5s validation, watches catalog scan progress in PT (closeable + reconnectable), lands on transparent scan-readiness summary, answers margin band question (with <5% segment warning), arrives at dashboard in DRY_RUN.

**Coverage:** FR8, FR9, FR10, FR11 (key vault wiring), FR12, FR13, FR14, FR15, FR16, FR17 (sku_channels schema only), FR25 (per-channel data model), FR33 (baseline_snapshots). NFRs: NFR-P6, NFR-P10, NFR-L1. ADs: AD6, AD15 partial, AD16 (with F4), AD26. UX-DRs: UX-DR2, UX-DR6, UX-DR23, UX-DR33, UX-DR34.

**Atomicity bundles:** F4 + onboarding scan ship together. The `customer_marketplaces` schema migration with PROVISIONING state + nullable A01/PC01 columns + CHECK constraint MUST ship in the same epic as the scan flow that populates those columns. Splitting would leave rows stuck in PROVISIONING with no path forward (CHECK constraint blocks the transition, but no scan code exists to populate the columns). The schema migration story (4.1) and the scan-orchestration story (4.4) land adjacent with a shared integration test.

**Phase 2 reservations:** `customer_marketplaces.tier_cadence_minutes_override` (JSONB nullable); `customer_marketplaces.anomaly_threshold_pct` (numeric nullable; defaults to 0.40 in code when null); `customer_marketplaces.edge_step_cents` (integer NOT NULL DEFAULT 1); `skus.cost_cents` (integer nullable); `skus.excluded_at` (timestamptz nullable); `customer_marketplaces.sustained_transient_cycle_threshold` flagged but NOT migrated at MVP per F10.

---

### Story 4.1: customer_marketplaces schema with F4 PROVISIONING + cron_state machine + transitions matrix
- **Trace:** Implements AD15 (schema + transitions matrix), AD16 (with F4 — PROVISIONING + nullable A01/PC01 + CHECK constraint), AD26 (PC01 capture columns + JSONB snapshot); FRs FR8 (foundation). Size L.
- **Atomicity:** F4 + onboarding scan ship adjacent (this story is the schema half; Story 4.4 is the population half). Splitting them would leave rows stuck in PROVISIONING forever.
- **Bob-trace:** SSoT: `shared/state/cron-state.js` (`transitionCronState`), `shared/state/transitions-matrix.js` (`LEGAL_CRON_TRANSITIONS`). Migration: `db/migrations/202604301203_create_customer_marketplaces.sql`. Depends on Story 1.4, Story 2.1, Story 2.2, Story 9.0 + Story 9.1 (audit foundation — `writeAuditEvent` + `audit_log_event_types` lookup + base partitioned table + priority trigger; ships calendar-early per Option A). Enables Stories 4.2, 4.3, 4.4; Epic 5; Epic 7; Epic 10; Epic 11.
- **ESLint rules:** `single-source-of-truth` (custom rule for cron_state UPDATE)
- **Acceptance Criteria:**
  1. **Given** the migration `202604301203_create_customer_marketplaces.sql` **When** I apply it **Then** the table exists per architecture's full schema: PK uuid, customer_id FK, operator enum (`marketplace_operator` with single value `'WORTEN'` at MVP), marketplace_instance_url, A01 columns (shop_id, shop_name, shop_state, currency_iso_code, is_professional, channels[]) — ALL NULLABLE, PC01 columns (channel_pricing_mode, operator_csv_delimiter, offer_prices_decimals, discount_period_required, competitive_pricing_tool, scheduled_pricing, volume_pricing, multi_currency, order_tax_mode, platform_features_snapshot JSONB, last_pc01_pulled_at) — ALL NULLABLE, engine config columns (max_discount_pct, max_increase_pct DEFAULT 0.0500, edge_step_cents DEFAULT 1, anomaly_threshold_pct, tier_cadence_minutes_override JSONB), cron_state enum DEFAULT `'PROVISIONING'`, cron_state_changed_at, stripe_subscription_item_id, timestamps **And** the cron_state enum has 8 values UPPER_SNAKE_CASE: `PROVISIONING`, `DRY_RUN`, `ACTIVE`, `PAUSED_BY_CUSTOMER`, `PAUSED_BY_PAYMENT_FAILURE`, `PAUSED_BY_CIRCUIT_BREAKER`, `PAUSED_BY_KEY_REVOKED`, `PAUSED_BY_ACCOUNT_GRACE_PERIOD` **And** the channel_pricing_mode enum has 3 values: `SINGLE`, `MULTI`, `DISABLED` **And** the csv_delimiter enum has 2 values: `COMMA`, `SEMICOLON` **And** the marketplace_operator enum has 1 value at MVP: `WORTEN`.
  2. **Given** the F4 CHECK constraint **When** the migration creates `customer_marketplace_provisioning_completeness` **Then** the constraint asserts: `cron_state = 'PROVISIONING' OR (all A01 + PC01 + last_pc01_pulled_at columns NOT NULL)` **And** an INSERT with `cron_state = 'DRY_RUN'` and any A01 or PC01 column NULL fails the CHECK **And** an INSERT with `cron_state = 'PROVISIONING'` and all A01/PC01 columns NULL succeeds **And** an UPDATE setting `cron_state = 'DRY_RUN'` while any A01/PC01 column is NULL fails the CHECK.
  3. **Given** the indexes from architecture's spec **When** I inspect the schema **Then** the following indexes exist: `idx_customer_marketplaces_customer_id`, `idx_customer_marketplaces_cron_state_active` (partial: WHERE cron_state = 'ACTIVE'), `idx_customer_marketplaces_last_pc01_pulled_at` **And** UNIQUE constraint `(customer_id, operator, shop_id)` prevents accidental dup-add.
  4. **Given** the RLS policies in the same migration **When** customer A is logged in **Then** `SELECT FROM customer_marketplaces WHERE id = <customer_B_marketplace_id>` returns 0 rows **And** UPDATE/DELETE attempts on customer B's row fail **And** founder admin via service role can read all rows **And** `scripts/rls-regression-suite.js` is extended with customer_marketplaces.
  5. **Given** `shared/state/transitions-matrix.js` exports `LEGAL_CRON_TRANSITIONS` **When** I open the file **Then** it is a JS object literal at the top of the module documenting every legal `(from, to)` transition:
      - `PROVISIONING → DRY_RUN` (scan complete with A01/PC01 populated)
      - `DRY_RUN → ACTIVE` (Go-Live click)
      - `ACTIVE → PAUSED_BY_CUSTOMER` (pause click)
      - `PAUSED_BY_CUSTOMER → ACTIVE` (resume click)
      - `ACTIVE → PAUSED_BY_PAYMENT_FAILURE` (Stripe webhook final-failure)
      - `PAUSED_BY_PAYMENT_FAILURE → ACTIVE` (customer re-enters payment + re-Go-Lives)
      - `ACTIVE → PAUSED_BY_CIRCUIT_BREAKER` (circuit-breaker trip)
      - `PAUSED_BY_CIRCUIT_BREAKER → ACTIVE` (manual unblock)
      - `ACTIVE → PAUSED_BY_KEY_REVOKED` (401 detected)
      - `PAUSED_BY_KEY_REVOKED → ACTIVE` (rotation flow validates new key)
      - `ACTIVE → PAUSED_BY_ACCOUNT_GRACE_PERIOD` (deletion initiated)
      - `PAUSED_BY_ACCOUNT_GRACE_PERIOD → DRY_RUN` (cancel-mid-grace; customer must re-enter Stripe per AD21)
    **And** the matrix is the single spec, NOT buried in `transitionCronState` conditionals.
  6. **Given** `shared/state/cron-state.js` exports `transitionCronState({tx, customerMarketplaceId, from, to, context})` **When** the helper is called inside an active transaction **Then** it issues `UPDATE customer_marketplaces SET cron_state = $to, cron_state_changed_at = NOW() WHERE id = $cmId AND cron_state = $from` (optimistic concurrency) **And** if 0 rows updated → throws `ConcurrentTransitionError` **And** if `(from, to)` is not in `LEGAL_CRON_TRANSITIONS` → throws `InvalidTransitionError` BEFORE issuing the UPDATE **And** the helper dispatches to a specific AD20 audit event_type per the `(from, to)` tuple via a static map at the top of `shared/state/cron-state.js`. The map (documented verbatim in the JSDoc of `transitionCronState`) is at minimum:
      - `(ACTIVE, PAUSED_BY_CUSTOMER)` → `customer-paused` (Notável)
      - `(PAUSED_BY_CUSTOMER, ACTIVE)` → `customer-resumed` (Notável)
      - `(ACTIVE, PAUSED_BY_CIRCUIT_BREAKER)` → `circuit-breaker-trip` (Atenção)
      - `(ACTIVE, PAUSED_BY_PAYMENT_FAILURE)` → `payment-failure-pause` (Atenção)
      - `(ACTIVE, PAUSED_BY_KEY_REVOKED)` → `key-validation-fail` (Atenção)
    **And** transitions WITHOUT an AD20 counterpart (e.g., `PROVISIONING → DRY_RUN`, `DRY_RUN → ACTIVE` Go-Live click, `ACTIVE → PAUSED_BY_ACCOUNT_GRACE_PERIOD`, manual unblocks back to ACTIVE) do NOT emit audit events **And** the JSDoc explicitly enumerates which transitions emit and which don't.
  7. **Given** unit tests in `tests/shared/state/cron-state.test.js` **When** I run them **Then** they cover: legal transition succeeds + emits audit event; illegal transition throws InvalidTransitionError without DB write; concurrent transition throws ConcurrentTransitionError.
  8. **Given** the negative-assertion check **When** I grep for raw `UPDATE customer_marketplaces SET cron_state` SQL **Then** matches only appear inside `shared/state/cron-state.js` **And** custom ESLint rule `single-source-of-truth` flags raw cron_state UPDATEs outside this module.

---

### Story 4.2: skus + sku_channels + baseline_snapshots + scan_jobs schemas + RLS
- **Trace:** Implements AD10 (schema only — engine logic Epic 7), AD16 step 4-7; FRs FR17 (schema), FR25, FR33. Size M.
- **Atomicity:** Bundle B — schema half lands here; engine logic continues in Epic 7.
- **Bob-trace:** Migrations: `db/migrations/202604301205_create_skus.sql`, `db/migrations/202604301206_create_sku_channels.sql`, `db/migrations/202604301207_create_baseline_snapshots.sql`, `db/migrations/202604301211_create_scan_jobs.sql`. Depends on Story 4.1. Enables Story 4.4 (populates these), Story 6.x (PRI01 reads sku_channels), Story 7.x (engine state).
- **Acceptance Criteria:**
  1. **Given** the migration `202604301205_create_skus.sql` **When** applied **Then** `skus` table has columns: id PK, customer_marketplace_id FK CASCADE, ean, shop_sku, product_sku, product_title, **`cost_cents` (integer NULLABLE — Phase 2 reservation)**, **`excluded_at` (timestamptz NULLABLE — Phase 2 reservation)**, timestamps **And** UNIQUE constraints: `(customer_marketplace_id, ean)` and `(customer_marketplace_id, shop_sku)` **And** index `idx_skus_customer_marketplace_id_ean` **And** RLS policy for customer-own access.
  2. **Given** the migration `202604301206_create_sku_channels.sql` **When** applied **Then** the `tier_value` enum is created with values `'1'`, `'2a'`, `'2b'`, `'3'` (lowercase taxonomic) **And** `sku_channels` has columns per architecture: id PK, sku_id FK CASCADE, customer_marketplace_id FK CASCADE, channel_code, list_price_cents (integer NOT NULL), last_set_price_cents (nullable), current_price_cents (nullable), pending_set_price_cents (nullable), pending_import_id (text nullable), tier (tier_value NOT NULL), tier_cadence_minutes (smallint NOT NULL), last_won_at (nullable), last_checked_at (NOT NULL), last_set_at (nullable), frozen_for_anomaly_review (boolean NOT NULL DEFAULT false), frozen_at (nullable), frozen_deviation_pct (nullable), min_shipping_price_cents (nullable), min_shipping_zone (nullable), min_shipping_type (nullable), channel_active_for_offer (boolean NOT NULL DEFAULT true), timestamps **And** UNIQUE constraint `(sku_id, channel_code)` **And** dispatcher hot-path index `idx_sku_channels_dispatch` (composite with WHERE `pending_import_id IS NULL AND frozen_for_anomaly_review = false AND excluded_at IS NULL`) **And** indexes `idx_sku_channels_tier`, `idx_sku_channels_pending_import_id` **And** RLS policy.
  3. **Given** the migration `202604301207_create_baseline_snapshots.sql` **When** applied **Then** the table holds the pre-tool snapshot: id PK, sku_channel_id FK CASCADE, customer_marketplace_id FK CASCADE, list_price_cents NOT NULL, current_price_cents NOT NULL, captured_at **And** index on sku_channel_id **And** RLS policy.
  4. **Given** the migration `202604301211_create_scan_jobs.sql` **When** applied **Then** `scan_jobs` table has: id PK, customer_marketplace_id FK CASCADE, status (`scan_job_status` enum with 9 values: PENDING, RUNNING_A01, RUNNING_PC01, RUNNING_OF21, RUNNING_P11, CLASSIFYING_TIERS, SNAPSHOTTING_BASELINE, COMPLETE, FAILED), phase_message (PT-localized; default `'A iniciar análise…'`), skus_total, skus_processed (NOT NULL DEFAULT 0), failure_reason, started_at, completed_at **And** EXCLUDE constraint enforces "one active scan per marketplace" (`status NOT IN ('COMPLETE', 'FAILED')`) **And** RLS policy.
  5. **Given** the RLS regression suite extension **When** I extend `scripts/rls-regression-suite.js` with these four tables **Then** the suite asserts customer A cannot read/write customer B's `skus`, `sku_channels`, `baseline_snapshots`, `scan_jobs` rows **And** the seed data adds at least one row per table per customer.

---

### Story 4.3: Key entry form `/onboarding/key` + inline 5s validation + encrypted persistence + Worten-key one-page guide modal
- **Trace:** Implements AD3 (vault wiring — module landed Story 1.2), AD16 step 1, UX-DR23; FRs FR8, FR9, FR10, FR11 (vault wiring); NFRs NFR-P6. Size L.
- **Bob-trace:** SSoT: `app/src/routes/onboarding/key.js`, `app/src/views/pages/onboarding-key.eta`, `app/src/views/modals/key-help.eta`, `app/src/views/components/trust-block.eta`. Depends on Stories 1.2, 1.4, 3.1, 3.3, 4.1. Enables Story 4.4.
- **Pattern A/B/C contract:**
  - Behavior: FR8, FR9, FR10, FR11; NFR-P6; UX-DR23
  - Structure: UX skeleton §3.2 + verified PT walkthrough copy delivered 2026-04-30
  - Visual: Pattern A — `_bmad-output/design-references/screens/16-onboarding-key-help.html` (Worten-key one-pager modal stub with verified PT walkthrough copy + redacted screenshots inline). The `/onboarding/key` form surface itself is also Pattern A (stubbed in `screens/<NN>-onboarding-key.html` per the screen→stub mapping appendix).
- **Acceptance Criteria:**
  1. **Given** the route `app/src/routes/onboarding/key.js` and template `onboarding-key.eta` **When** an authenticated customer (with no existing customer_marketplace row OR a row in PROVISIONING with no validated key) lands on `GET /onboarding/key` **Then** the page renders with a single-purpose API key input, the trust block (UX-DR23) below it, a "Como gerar a chave?" link opening the modal, and a "Validar chave" button (disabled until input non-empty).
  2. **Given** the trust block per UX-DR23 (component `app/src/views/components/trust-block.eta`) **When** rendered **Then** it carries the lock icon (`lock` filled, var(--mp-win)), green-edged box, the verbatim PT copy from UX skeleton §5.1: *"A tua chave fica **encriptada em repouso**. Apenas o motor de repricing a usa para falar com o Worten — nem o nosso fundador a vê em texto puro."* + the "Ver as nossas garantias →" link to `/security` modal stub.
  3. **Given** the customer pastes a key and clicks Validar **When** the form posts to `POST /onboarding/key/validate` **Then** the route runs ONE P11 call against a known-good reference EAN via `shared/mirakl/p11.js` (Story 3.2) within a 5-second timeout **And** the spinner shows label `"A validar a tua chave..."` **And** on success: the key is encrypted via `shared/crypto/envelope.js` (Story 1.2), persisted as a new `shop_api_key_vault` row, AND a new `customer_marketplaces` row is created with `cron_state = 'PROVISIONING'`, `operator = 'WORTEN'`, `marketplace_instance_url = 'https://marketplace.worten.pt'`, A01/PC01 columns NULL (CHECK constraint allows because PROVISIONING) **And** on failure (401): inline red error in `onboarding-key.eta` with PT-localized message from `getSafeErrorMessage` (Story 3.1) **And** on network/transport error: inline retry CTA with PT-localized message **And** the cleartext key is never logged.
  4. **Given** validation succeeds **When** the route completes **Then** the customer is redirected to `/onboarding/scan` (Story 4.4 picks up scan_jobs row) **And** `shop_api_key_vault.last_validated_at` is set to NOW() — this timestamp is the customer-visible signal of successful validation; NO audit event is emitted because `KEY_VALIDATED` is not in AD20's locked taxonomy. Customer surfaces (Story 5.2 settings/key vault status pill) read `last_validated_at` directly.
  5. **Given** the customer clicks "Como gerar a chave?" **When** the modal `app/src/views/modals/key-help.eta` opens **Then** it shows the one-page guide content (FR10) walking through Worten Seller Center → Account → API in 3 screenshots (image assets in `public/images/key-guide/*`) **And** the modal closes via Escape key OR "Fechar" button **And** keyboard navigation works without mouse (NFR-A2).
  6. **Given** an integration test **When** I run `tests/integration/key-entry.test.js` **Then** it covers: valid key → encrypted vault row created + customer_marketplace row in PROVISIONING + redirect to /onboarding/scan; invalid key (401 from mock Worten) → inline error + no vault row created; 5-second-timeout → inline retry CTA; cleartext key never appears in pino output.
  7. **Given** the Pattern A visual reference is `screens/16-onboarding-key-help.html` **When** Story 4.3 is implemented **Then** before being considered shippable to the first paying customer, Pedro signs off on the rendered output of the `/onboarding/key` page + "Como gerar?" modal against the stub **And** the sign-off is recorded as a comment on the merged PR or in `_bmad-output/sign-offs/story-4.3.md` **And** any visual deviations from the stub are either fixed or documented as accepted deviations with rationale.

---

### Story 4.4: Async catalog scan orchestration — A01 → PC01 → OF21 → P11 → tier classify → baseline (atomicity sibling of Story 4.1)
- **Trace:** Implements AD16 (full sequence), AD26 (PC01 capture), F4 (transitions out of PROVISIONING); FRs FR12, FR14, FR17 (population), FR25 (per-channel population); NFRs NFR-P10, NFR-Sc2. Size L.
- **Atomicity:** Bundle (with Story 4.1) — F4 + onboarding scan ship adjacent. The CHECK constraint blocks transition out of PROVISIONING until A01/PC01 populate; this story populates them. Without 4.4, rows from 4.3 stay in PROVISIONING forever.
- **Bob-trace:** SSoT: `worker/src/jobs/onboarding-scan.js`, `worker/src/lib/tier-classify.js` (initial classification only — engine logic Epic 7). Depends on Stories 3.2, 3.3, 4.1, 4.2, 4.3. Enables Story 4.5, 4.7; Epic 5.
- **Acceptance Criteria:**
  1. **Given** a customer_marketplaces row in PROVISIONING with a freshly-validated encrypted key in `shop_api_key_vault` **When** the worker process picks up a `scan_jobs` row in PENDING status (created by Story 4.3 redirect) **Then** `worker/src/jobs/onboarding-scan.js` orchestrates this sequence:
      1. Decrypt the customer's key via `shared/crypto/envelope.js`
      2. **Smoke-test reuse:** call `scripts/mirakl-empirical-verify.js` programmatically against the customer's key — if any assertion fails, transition `scan_jobs.status = FAILED`, persist `failure_reason`, send Story 4.6's failure email
      3. Status `RUNNING_A01`: call `getAccount` (Story 3.2), persist shop_id, shop_name, shop_state, currency_iso_code, is_professional, channels[] to customer_marketplaces
      4. Status `RUNNING_PC01`: call `getPlatformConfiguration`, persist channel_pricing_mode, operator_csv_delimiter, offer_prices_decimals, discount_period_required, competitive_pricing_tool, scheduled_pricing, volume_pricing, multi_currency, order_tax_mode, platform_features_snapshot (full JSONB), last_pc01_pulled_at = NOW()
      5. **Abort if** `channel_pricing_mode = DISABLED` — transition scan_jobs to FAILED with PT-localized failure_reason
      6. Status `RUNNING_OF21`: paginate `getOffers` and bulk-load skus + sku_channels rows (one per (SKU, channel) the offer is sellable on; channel_active_for_offer=true). Track `scan_jobs.skus_total` and `skus_processed`
      7. Status `RUNNING_P11`: for each EAN, batch 100 EANs per call, 2 calls per channel (PT and ES if both active); apply `shared/mirakl/self-filter.js` (Story 3.2) post-fetch — filter chain `active === true && total_price > 0 && shop_name !== ownShopName`, sort ascending by total_price; collision detection per AD13 (>1 offer matching ownShopName → emit `shop-name-collision-detected` Atenção event + skip cycle for that SKU)
      8. Status `CLASSIFYING_TIERS`: assign each sku_channel row to T1/T2a/T2b/T3 per AD10's rules (winning SKUs land T2a with `last_won_at = NOW()` since no win history exists at scan time); assign tier_cadence_minutes per AD10 defaults
      9. Status `SNAPSHOTTING_BASELINE`: copy `current_price_cents → list_price_cents` for every sku_channel; persist `baseline_snapshots` row per (SKU, channel)
      10. Status `COMPLETE`: call `transitionCronState` (PROVISIONING → DRY_RUN); CHECK constraint passes because A01/PC01 columns are now populated.
  2. **Given** any step in the orchestrator throws **When** the failure is caught **Then** scan_jobs.status → FAILED, failure_reason persisted, email sent (Story 4.6) **And** the customer_marketplaces row stays in PROVISIONING (CHECK constraint blocks transition since A01/PC01 columns may be partially populated) **And** customer can re-validate key + re-trigger scan (idempotent — scan_jobs EXCLUDE constraint allows new scan once previous is COMPLETE/FAILED).
  3. **Given** the scan is in-flight **When** Story 4.5's progress page polls `GET /onboarding/scan/status` **Then** it returns `{status, phase_message, skus_total, skus_processed}` **And** phase_message is PT-localized per UX-DR6: "A configurar integração com Worten" (A01+PC01), "A obter catálogo" (OF21), "A snapshotar baselines" (P11+classify), "A classificar tiers iniciais", "Pronto".
  4. **Given** scan throughput **When** the scan runs against a 50k-SKU catalog (test scenario) **Then** target: complete within 4 hours (NFR-P10) **And** if the scan exceeds 8 hours, the worker logs a warning + emits an Atenção audit event.
  5. **Given** an integration test **When** I run `tests/integration/onboarding-scan.test.js` against the Mirakl mock server seeded with 200-SKU fixture data **Then** the orchestrator runs through all 9 phases, populates customer_marketplaces + skus + sku_channels + baseline_snapshots, transitions to DRY_RUN, completes within a generous test timeout (60s for 200 SKUs) **And** the test asserts no cleartext key appears in pino output, no parallel scan_jobs row exists, the CHECK constraint never violated, and PRI02 is never called (read-only).

---

### Story 4.5: Scan progress page `/onboarding/scan` — closeable + reconnectable + status polling
- **Trace:** Implements AD16 (UX), UX-DR6; FRs FR13, FR14. Size M.
- **Bob-trace:** SSoT: `app/src/routes/onboarding/scan.js`, `app/src/views/pages/onboarding-scan.eta`, `public/js/scan-progress.js`. Depends on Story 4.4. Enables Story 4.6, 4.7.
- **Pattern A/B/C contract:**
  - Behavior: FR13, FR14; UX-DR6
  - Structure: UX skeleton §3.3 ProgressScreen + AD16 Pass-2 UX delta covering A01 + PC01
  - Visual: Pattern B — UX skeleton §3.3 ProgressScreen + visual fallback `_bmad-output/design-references/bundle/project/MarketPilot.html` ProgressScreen pattern (radial progress glyph + shimmer bar + 5-phase checklist per UX-DR6 + AD16 Pass-2 UX delta). No dedicated screens/ stub.
- **Acceptance Criteria:**
  1. **Given** the route `GET /onboarding/scan` **When** a customer with an in-flight scan_jobs row visits **Then** the page renders with: 5-phase progress (UX-DR6 labels + prepended "A configurar integração com Worten" phase per architecture AD16 Pass-2 UX delta covering A01 + PC01), shimmer bar showing skus_processed/skus_total, current `phase_message` **And** `public/js/scan-progress.js` polls `GET /onboarding/scan/status` every 1 second **And** on `status: COMPLETE` → redirects to `/onboarding/scan-ready` **And** on `status: FAILED` → redirects to `/scan-failed` (Story 4.6) **And** the page is closeable — closing the tab does NOT abort the scan; reopening returns to live progress.
  2. **Given** the disconnected/reconnected case **When** a customer closes the tab during RUNNING_OF21 and reopens 30 minutes later (scan still running) **Then** the same progress page renders showing live progress at whatever phase the scan is now in **And** the polling resumes immediately.
  3. **Given** the route handler **When** `GET /onboarding/scan/status` is called **Then** it returns JSON `{status, phase_message, skus_total, skus_processed, started_at, completed_at}` **And** the endpoint is RLS-aware (customer can only read their own scan_jobs row) **And** the endpoint is rate-limited via `@fastify/rate-limit` to 5 req/sec per customer.
  4. **Given** a customer attempts to access `/onboarding/scan` with no in-flight scan_jobs row **When** the route loads **Then** it redirects to the appropriate state — `/onboarding/key` if no key, `/onboarding/scan-ready` if scan COMPLETE, `/scan-failed` if FAILED **And** UX-DR2 (strictly forward state machine) is honored.

---

### Story 4.6: Scan-failed email + `/scan-failed` interception
- **Trace:** Implements AD16 (failure handling), UX-DR3; FRs FR15. Size S.
- **Bob-trace:** SSoT: `shared/resend/client.js` (`sendCriticalAlert({to, subject, html})` — minimal canonical interface), `app/src/routes/interceptions/scan-failed.js`, `app/src/views/pages/scan-failed.eta`, `app/src/views/emails/scan-failed.eta`. Depends on Story 4.4. SSoT discipline: Story 4.6 ships the minimal `shared/resend/client.js` as the single canonical interface from day one — Epic 12 (Story 12.3) extends. NO parallel implementation, NO later refactor. Enables customer recovers via re-validation.
- **Pattern A/B/C contract:**
  - Behavior: FR15; UX-DR3
  - Structure: UX skeleton §8.1 (interception pattern)
  - Visual: Pattern A — `/scan-failed` interception page stubbed at `_bmad-output/design-references/screens/<NN>-scan-failed.html` per the screen→stub mapping appendix; email template rendered from `app/src/views/emails/scan-failed.eta` follows visual-DNA tokens.
- **Acceptance Criteria:**
  1. **Given** scan_jobs.status transitions to FAILED **When** the worker writes the FAILED status **Then** within ≤5 minutes (NFR-P9), the customer receives a PT-localized email via `shared/resend/client.js`'s `sendCriticalAlert({to, subject, html})` — html rendered from `app/src/views/emails/scan-failed.eta` **And** the email subject: *"A análise do teu catálogo MarketPilot não conseguiu completar"* **And** the body explains the failure reason + provides a link to `/onboarding/key` for re-validation.
  2. **Given** a customer with a FAILED scan_jobs row logs in to dashboard **When** the auth landing logic runs (UX-DR3) **Then** it overrides `/` with `/scan-failed` interception **And** the page renders with the failure reason + "Tentar novamente →" button leading to `/onboarding/key` rotation flow **And** the page is keyboard-accessible (NFR-A2).
  3. **Given** a healthy scan completion **When** the orchestrator transitions to COMPLETE **Then** NO email is sent (per FR15 — only failure triggers email) **And** the customer logs back in to find populated dashboard.

---

### Story 4.7: Scan-ready interstitial `/onboarding/scan-ready` (UX-DR33-34)
- **Trace:** Implements UX-DR33, UX-DR34; FRs FR16 (gateway to margin question). Size S.
- **Bob-trace:** SSoT: `app/src/routes/onboarding/scan-ready.js`, `app/src/views/pages/onboarding-scan-ready.eta`. Depends on Story 4.4. Enables Story 4.8.
- **Pattern A/B/C contract:**
  - Behavior: FR16 (gateway); UX-DR33, UX-DR34
  - Structure: UX skeleton §8.3
  - Visual: Pattern A — `_bmad-output/design-references/screens/10-onboarding-scan-ready.html` per the screen→stub mapping appendix.
- **Acceptance Criteria:**
  1. **Given** a customer with cron_state = DRY_RUN and scan_jobs status = COMPLETE **When** they hit `/onboarding/scan-ready` **Then** the page renders with the count summary per UX-DR33 layout:
      - "X produtos encontrados no Worten" (total OF21 SKUs)
      - "Y prontos para repricing" (sku_channels rows with tier IN (1, 2a, 2b))
      - "Z sem competidores (Tier 3 — vamos monitorizar)" (tier = 3)
      - "W sem EAN no Worten — ignorados" (OF21 SKUs without EAN — counted but no sku_channels row)
    **And** counts come from queries against the populated tables, NOT placeholders.
  2. **Given** the "porquê?" disclosure (UX-DR34) **When** the customer clicks it **Then** the inline disclosure expands with verbatim copy from UX skeleton §8.3: *"Produtos refurbished e listings privados não têm EAN partilhado no Worten — não conseguimos ver competidores no mesmo produto. Ficam fora do scope do repricing automático. Isto é estrutural ao Worten, não uma limitação da MarketPilot."*
  3. **Given** the "Continuar →" button **When** clicked **Then** the customer is redirected to `/onboarding/margin` (Story 4.8).
  4. **Given** UX-DR2 (strictly-forward state machine) **When** a customer with cron_state = DRY_RUN tries to skip back to `/onboarding/scan` **Then** they're redirected to `/onboarding/scan-ready`.

---

### Story 4.8: Margin question `/onboarding/margin` + smart-default mapping + <5% warning
- **Trace:** Implements AD16 (final onboarding step), UX-DR2; FRs FR16. Size M.
- **Bob-trace:** SSoT: `app/src/routes/onboarding/margin.js`, `app/src/views/pages/onboarding-margin.eta`, `app/src/views/components/smart-default-warning-thin-margin.eta`. Depends on Story 4.7, Story 4.1 (max_discount_pct + max_increase_pct columns). Enables Story 4.9.
- **Pattern A/B/C contract:**
  - Behavior: FR16
  - Structure: UX skeleton §3.3 + §9.10 callout
  - Visual: Pattern B — UX skeleton §3.3 + visual-DNA tokens (4 radio bands + inline §9.10 callout for `<5%`). Downstream Claude Design pass produces a dedicated stub if visual tension surfaces; otherwise the skeleton + tokens suffice.
- **Acceptance Criteria:**
  1. **Given** the route `GET /onboarding/margin` **When** a customer with cron_state = DRY_RUN and a populated catalog visits **Then** the page renders the band picker with 4 options (radio): `<5%`, `5-10%`, `10-15%`, `15%+` **And** the page is PT-localized.
  2. **Given** the customer picks `<5%` **When** the choice is made (client-side reactive) **Then** an inline warning callout appears (UX skeleton §9.10): yellow-edged box, info icon, full PT copy verbatim including the 3 bulleted recommendations and "Compreendo e continuo" acknowledgement button (must click before submit).
  3. **Given** the customer submits **When** `POST /onboarding/margin` runs **Then** the route persists `customer_marketplaces.max_discount_pct` per smart-default mapping:
      - `<5%` → 0.005 (0.5%)
      - `5-10%` → 0.01 (1%)
      - `10-15%` → 0.02 (2%)
      - `15%+` → 0.03 (3%)
    **And** `max_increase_pct = 0.05` (5% global default) **And** redirects to `/`.
  4. **Given** UX-DR2 (strictly-forward) **When** a customer with margin already set tries to revisit `/onboarding/margin` **Then** they're redirected to `/`.

---

### Story 4.9: Dashboard root in DRY_RUN — minimal landing only
- **Trace:** Implements UX-DR3, UX-DR13 (KPI card visual treatment but no full dashboard yet); FRs FR30 partial. Size S.
- **Bob-trace:** SSoT: `app/src/routes/dashboard/index.js` (minimal — full page Epic 8), `app/src/views/pages/dashboard-dry-run-minimal.eta`. Depends on Story 4.8. Enables Epic 5 dispatcher reads from a working customer_marketplaces row; Epic 8 expands this stub.
- **Pattern A/B/C contract:**
  - Behavior: FR30 partial; UX-DR3, UX-DR13
  - Structure: UX skeleton §3.1 + §9.5 (banner copy)
  - Visual: Pattern A — minimal landing in DRY_RUN state stubbed at `_bmad-output/design-references/screens/26-dashboard-dryrun-minimal.html`; Epic 8 stories ship the full state-aware dashboard with separate stubs per state.
- **Acceptance Criteria:**
  1. **Given** a customer with cron_state = DRY_RUN **When** they visit `/` **Then** the page renders the dry-run banner per UX skeleton §9.5: blue, science icon, full PT copy verbatim **And** the page shows a single KPI card stub ("3 status cards visuals coming in Epic 8") — explicit placeholder text is acceptable at MVP **And** the page links to `/audit` (audit log will populate as cycles run) **And** there is NO Go-Live button at this stage (Go-Live ships in Epic 8).
  2. **Given** a customer with cron_state = PROVISIONING **When** they visit `/` **Then** they're redirected to `/onboarding/scan` (UX-DR2 forward-only).
