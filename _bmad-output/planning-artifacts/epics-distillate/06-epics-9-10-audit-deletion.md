---
type: bmad-distillate-section
sources:
  - "../epics.md"
parent: "_index.md"
part: 6
of: 8
---

This section covers Epic 9 Audit Log (Stories 9.0–9.6, 7 stories) and Epic 10 Account Deletion & Grace (3 stories) — 10 stories total. Part 6 of 8 from epics.md.

> **CALENDAR-EARLY SEQUENCING — CRITICAL.** Stories 9.0 and 9.1 are the foundation that ships as **Story 1.x calendar siblings** (BEFORE Epic 5's dispatcher), even though they're labeled Epic 9. Stories 9.2-9.6 (5-surface IA + KPI aggregates + search + firehose + archive) ship later in §I phase 7 order. Bob does NOT shard Epic 9 in numerical order — the foundation ships first per architecture's note: *"Story 9.1 (audit_log schema + writer module) is a Story 1.x sibling — must land before any feature that emits events."* Epics 5, 7, 10, 11, 12 all emit audit events; the foundation must exist when those epics ship.

## Epic 9: Audit Log

**Goal.** 5-surface IA — daily summary card (5-min refresh), Atenção feed (action-required, expanded by default, steady-state 0-2/day), Notável feed (browsable, capped 30 with "Ver todos"), search-by-SKU (primary investigation primitive — sticky-top search, last 90 days default), firehose (cycle-aggregated, opt-in, paginated 50 cycles/page with lazy-loaded SKU expansion). Volume-tested at ~3M entries/quarter on a 50k contested catalog. Append-only at app layer with monthly partitioning + compound indexes + precomputed daily/cycle aggregates. Event-type taxonomy enforced via lookup table + priority-derivation trigger.

**Coverage:** FR37, FR38, FR38b, FR38c, FR38d. NFR-P8, NFR-S6, NFR-A3. ADs: AD19 (with F8), AD20. UX-DRs: UX-DR7, UX-DR8, UX-DR9, UX-DR10, UX-DR11, UX-DR12.

**Constraints:** `audit_log` event types in story acceptance criteria reference architecture AD20's enumerated list (7 Atenção / 8 Notável / 11 Rotina = 26 base seed), NOT the prose summary's count "6 / 8 / 11". 27th row added by Story 12.1 (`cycle-fail-sustained`); 28th by Story 12.3 (`platform-features-changed`).

---

### Story 9.0: `writeAuditEvent` SSoT module + `audit_log_event_types` lookup table + 26-row AD20 taxonomy seed [CALENDAR-EARLY — Story 1.x sibling]
- **Trace:** Implements AD20 (taxonomy + lookup), F5 (migration ordering); FRs FR38d (event-type taxonomy at three priority levels); NFRs NFR-S6 (append-only at app layer). Size M.
- **Notes:** [CALENDAR-EARLY — Story 1.x sibling] SHIPS BEFORE Epic 5 dispatcher (Story 5.1 imports `writeAuditEvent`). Epic 1 stories that emit events (Story 4.1's `transitionCronState`) depend on this. Bob's sprint-ordering must front-load Story 9.0 alongside Stories 1.x even though it's labeled Epic 9.
- **Bob-trace:** SSoT: `shared/audit/writer.js` (`writeAuditEvent`), `shared/audit/event-types.js` (enum + JSDoc `@typedef PayloadFor<EventType>` per audit event type), `eslint-rules/no-raw-INSERT-audit-log.js`. Migration: `db/migrations/202604301207a_create_audit_log_event_types.sql` (table + 26-row seed; F5 amendment migration ordering — runs BEFORE `audit_log` partitioned base table in Story 9.1). Depends on Story 1.1 (scaffold), Story 1.4 (RLS context for app-side reads). Enables Story 9.1, every event-emitting story across Epics 4-12.
- **ESLint rules:** `no-raw-INSERT-audit-log`
- **Acceptance Criteria:**
  1. **Given** the migration `202604301207a_create_audit_log_event_types.sql` **When** I apply it **Then** the `audit_log_priority` enum is created with three values: `'atencao'`, `'notavel'`, `'rotina'` (lowercase taxonomic, no diacritics for SQL safety per architecture pattern doc) **And** the `audit_log_event_types` lookup table exists with columns: `event_type TEXT PRIMARY KEY`, `priority audit_log_priority NOT NULL`, `description TEXT NOT NULL` (PT-localized hint) **And** the migration seeds **exactly 26 rows** matching architecture AD20's enumerated taxonomy:
      - **7 Atenção rows:** `anomaly-freeze`, `circuit-breaker-trip`, `circuit-breaker-per-sku-trip`, `key-validation-fail`, `pri01-fail-persistent`, `payment-failure-pause`, `shop-name-collision-detected`
      - **8 Notável rows:** `external-change-absorbed`, `position-won`, `position-lost`, `new-competitor-entered`, `large-price-move-within-tolerance`, `customer-paused`, `customer-resumed`, `scan-complete-with-issues`
      - **11 Rotina rows:** `undercut-decision`, `ceiling-raise-decision`, `hold-floor-bound`, `hold-ceiling-bound`, `hold-already-in-1st`, `cycle-start`, `cycle-end`, `pri01-submit`, `pri02-complete`, `pri02-failed-transient`, `tier-transition`
    **And** each row's `description` is a short PT-localized hint (e.g., for `anomaly-freeze`: *"Mudança externa de preço >40% — congelado para revisão"*) **And** an integration test asserts `SELECT COUNT(*) FROM audit_log_event_types` returns exactly 26 **And** there is no FK from `audit_log_event_types.event_type` to anything (it's a lookup table; FKs flow inward — `audit_log.event_type → audit_log_event_types.event_type`).
  2. **Given** `shared/audit/event-types.js` **When** I open the file **Then** it exports a `EVENT_TYPES` constant (object literal) mirroring the 26 seeded rows + their priorities — used as the JS-side single-source-of-truth for event_type strings **And** for each event_type, a JSDoc `@typedef PayloadFor<EventType>` documents the structured payload shape (e.g., `PayloadForExternalChangeAbsorbed = { previousListPriceCents: number, newListPriceCents: number, deviationPct: number }`) **And** subagents adding a new event_type MUST add the migration row + the typedef + the constant in the same PR.
  3. **Given** `shared/audit/writer.js` exports `writeAuditEvent({tx, customerMarketplaceId, skuId, skuChannelId, eventType, cycleId, payload})` **When** called inside an active transaction **Then** the function INSERTs into `audit_log` (table created in Story 9.1) with the provided fields **And** `priority` is NOT explicitly set — it's derived by Story 9.1's `audit_log_set_priority` BEFORE INSERT trigger **And** if `eventType` is not in `EVENT_TYPES` constant, the function throws `UnknownEventTypeError` (additional guard alongside Story 9.1's trigger-level RAISE EXCEPTION) **And** the `payload` JSONB field is required NON-NULL (architecture mandates structured payload, never freeform string).
  4. **Given** the custom ESLint rule `eslint-rules/no-raw-INSERT-audit-log.js` **When** ESLint runs **Then** any `INSERT INTO audit_log` raw SQL OR `client.from('audit_log').insert(...)` Supabase-style insert OUTSIDE `shared/audit/writer.js` triggers a lint error: *"Raw audit_log INSERT forbidden. Use shared/audit/writer.js's writeAuditEvent for all audit emissions."* **And** the rule's allowlist is `shared/audit/writer.js` (the only legitimate INSERT path) **And** Story 1.1's ESLint config is updated to load this rule.
  5. **Given** the calendar-early shipping order **When** Bob shards the sprint **Then** Stories 9.0 and 9.1 are scheduled to ship BEFORE Story 5.1 (dispatcher) — even though Epic 9's UI portion ships in §I phase 7 order **And** the sprint-status doc explicitly notes the out-of-numerical-order shipping for Stories 9.0 + 9.1.

---

### Story 9.1: `audit_log` partitioned base table + priority-derivation trigger + initial partition + monthly partition cron [CALENDAR-EARLY — Story 1.x sibling]
- **Trace:** Implements AD19 (with F8 — no FK on sku_id / sku_channel_id), AD20 (priority trigger); FRs FR37 partial (storage layer); NFRs NFR-S6, NFR-P8 (foundation). Size L.
- **Notes:** [CALENDAR-EARLY — Story 1.x sibling] SHIPS BEFORE Epic 5 alongside Story 9.0. Order within Epic 1: Story 9.0 → Story 9.1 → all event-emitting stories. The `monthly-partition-create.js` cron uses Story 5.1's cron dispatcher infrastructure with the `// safe: cross-customer cron` ESLint opt-out from the `worker-must-filter-by-customer` rule (BAD-subagent retrofit pragma cross-reference).
- **Bob-trace:** SSoT: `worker/src/jobs/monthly-partition-create.js`. Migration: `db/migrations/202604301208_create_audit_log_partitioned.sql` (partitioned base table + initial month partition + priority trigger function). Depends on Story 9.0 (event_types lookup must exist for FK), Story 1.1 (worker for cron), Story 2.1 (RLS clients). Enables Story 9.0's `writeAuditEvent` has a table to write to; every event-emitting story across Epics 4-12 produces persisted rows.
- **Acceptance Criteria:**
  1. **Given** the migration `202604301208_create_audit_log_partitioned.sql` **When** I apply it **Then** the `audit_log` base table exists per architecture's schema:
      - `id uuid NOT NULL DEFAULT gen_random_uuid()`
      - `customer_marketplace_id uuid NOT NULL`
      - `sku_id uuid` — **NO FK constraint per F8 amendment** (preserves audit history if a SKU is later removed from catalog; audit log is immutable per NFR-S6, referential integrity to ephemeral catalog rows would compromise that)
      - `sku_channel_id uuid` — **NO FK constraint per F8 amendment** (same rationale)
      - `cycle_id uuid` — null outside cycle context
      - `event_type text NOT NULL REFERENCES audit_log_event_types(event_type)` (FK to lookup table is OK — event_types is a versioned schema, not ephemeral catalog data)
      - `priority audit_log_priority NOT NULL` (denormalized via trigger)
      - `payload jsonb NOT NULL` (structured per @typedef)
      - `resolved_at timestamptz` (for Atenção events resolved by customer per Story 7.4 + Story 7.6)
      - `created_at timestamptz NOT NULL DEFAULT NOW()`
      - `PRIMARY KEY (id, created_at)` (composite for partitioning)
    **And** the table is `PARTITION BY RANGE (created_at)` **And** an inline schema comment documents the F8 no-FK rationale (so future devs don't reflexively add the FK "for cleanliness").
  2. **Given** the initial month partition **When** the migration runs in May 2026 (or whatever month MVP launches) **Then** the partition `audit_log_2026_05` is created `FOR VALUES FROM ('2026-05-01') TO ('2026-06-01')` **And** Bob seeds 12 months ahead manually as part of this story (Story 9.1's migration creates partitions through `audit_log_2027_04`) **And** subsequent month creation is automated by the cron (below).
  3. **Given** the priority-derivation trigger **When** an `INSERT INTO audit_log` runs **Then** the `audit_log_set_priority` BEFORE INSERT trigger function fires:
      ```sql
      SELECT priority INTO NEW.priority FROM audit_log_event_types WHERE event_type = NEW.event_type;
      IF NEW.priority IS NULL THEN
        RAISE EXCEPTION 'Unknown audit_log event_type: %', NEW.event_type;
      END IF;
      ```
    **And** the trigger guarantees `audit_log.priority` always matches the lookup table — denormalization is internally consistent.
  4. **Given** the compound indexes per AD19 **When** I inspect the schema **Then** the following indexes exist on the partitioned base table (Postgres propagates to partitions):
      - `idx_audit_log_customer_created ON audit_log(customer_marketplace_id, created_at DESC)` — primary
      - `idx_audit_log_customer_sku_created ON audit_log(customer_marketplace_id, sku_id, created_at DESC) WHERE sku_id IS NOT NULL` — search-by-SKU surface (Story 9.4)
      - `idx_audit_log_customer_eventtype_created ON audit_log(customer_marketplace_id, event_type, created_at DESC)` — feed filtering (Story 9.3)
      - `idx_audit_log_customer_cycle ON audit_log(customer_marketplace_id, cycle_id, sku_id) WHERE cycle_id IS NOT NULL` — firehose drill-down (Story 9.5)
  5. **Given** RLS policies on the partitioned table **When** customer A queries `audit_log` via the RLS-aware client **Then** customer A only sees their own customer_marketplace_id rows **And** INSERT/UPDATE/DELETE are forbidden for customers (NFR-S6 append-only at app layer; only worker via service-role inserts) **And** `scripts/rls-regression-suite.js` extended with `audit_log` partitioned table coverage.
  6. **Given** `worker/src/jobs/monthly-partition-create.js` registered with `node-cron` to run on the 28th of each month at 02:00 Lisbon (`0 2 28 * *` with TZ adjustment) **When** the cron tick fires **Then** the job creates the partition for the FOLLOWING month (e.g., on May 28th 02:00 → creates `audit_log_2026_07` for July if not exists; the buffer ensures partitions exist before they're needed) **And** uses `IF NOT EXISTS` semantics — safe to re-run idempotently **And** logs at `info` level via pino with the new partition's date range **And** if the create fails (e.g., partition already exists, schema mismatch), logs at `error` level + emits an audit event `cycle-fail-sustained` (or admin-only alert — Bob picks). NOTE: the cron uses `// safe: cross-customer cron` opt-out from the `worker-must-filter-by-customer` ESLint rule.
  7. **Given** an integration test **When** I run `tests/integration/audit-log-partition.test.js` **Then** it covers: trigger-driven priority derivation; INSERT with unknown event_type raises EXCEPTION; INSERT for a known event_type lands in the correct month's partition; cross-tenant SELECT returns 0 rows (RLS); compound index hit verified via EXPLAIN.

---

### Story 9.2: `daily_kpi_snapshots` + `cycle_summaries` schemas + daily-aggregate cron + 5-min "today" partial refresh
- **Trace:** Implements AD19 (precomputed aggregates), Story 8.2 KPI cards' data source; FRs FR34 partial (data); NFRs NFR-P8 (≤2s on 90-day window — aggregates make this feasible). Size M.
- **Bob-trace:** SSoT: `worker/src/jobs/daily-kpi-aggregate.js`, `worker/src/engine/kpi-derive.js` (cycle-end aggregation → cycle_summaries; consumed by Story 5.2's cycle-end hook). Migrations: `db/migrations/202604301209_create_daily_kpi_snapshots.sql`, `db/migrations/202604301210_create_cycle_summaries.sql`. Depends on Story 9.0 + Story 9.1 (audit_log foundation), Story 5.2 (cycle-end hook), Story 4.1 (customer_marketplace), Story 4.2 (sku_channels for tier-derived counts). Enables Story 8.2 KPI cards consume `daily_kpi_snapshots`; Story 9.5 firehose consumes `cycle_summaries`.
- **Acceptance Criteria:**
  1. **Given** the migration `202604301209_create_daily_kpi_snapshots.sql` **When** applied **Then** `daily_kpi_snapshots` table exists per architecture: composite PK `(customer_marketplace_id, channel_code, date)`, columns for skus_in_first_count, skus_losing_count, skus_exclusive_count, catalog_value_at_risk_cents, undercut_count, ceiling_raise_count, hold_count, external_change_absorbed_count, anomaly_freeze_count, refreshed_at **And** index `idx_daily_kpi_snapshots_date ON daily_kpi_snapshots(date)` **And** RLS policy for customer-own access via customer_marketplace_id chain **And** RLS regression suite extended.
  2. **Given** the migration `202604301210_create_cycle_summaries.sql` **When** applied **Then** `cycle_summaries` table exists per architecture: cycle_id PK, customer_marketplace_id FK CASCADE, started_at, completed_at, tier_breakdown JSONB (e.g., `{"1": 300, "2a": 50, "2b": 100, "3": 20}`), undercut_count, ceiling_raise_count, hold_count, failure_count, circuit_breaker_tripped boolean, skus_processed_count **And** index `idx_cycle_summaries_customer_started ON cycle_summaries(customer_marketplace_id, started_at DESC)` **And** RLS policy + regression suite extension.
  3. **Given** `worker/src/engine/kpi-derive.js` is called at cycle-end by Story 5.2's cycle-assembly **When** a cycle completes **Then** the function INSERTs a `cycle_summaries` row with the aggregated counts derived from the cycle's audit events + sku_channels state **And** the INSERT is in the same transaction as the cycle-end audit event (atomicity: cycle_summaries.cycle_id matches the dispatcher's cycle_id).
  4. **Given** `worker/src/jobs/daily-kpi-aggregate.js` registered with `node-cron` **When** it runs at midnight Lisbon (`0 0 * * *`) **Then** for each active customer_marketplace, computes yesterday's `daily_kpi_snapshots` row from yesterday's `audit_log` events + sku_channels state-at-midnight snapshot **And** UPSERTs the row keyed on `(customer_marketplace_id, channel_code, date=yesterday)`.
  5. **Given** the 5-min "today" partial refresh **When** the same cron tick fires every 5 minutes (separate sub-job within `daily-kpi-aggregate.js` or a sibling cron) **Then** for each active customer_marketplace, recomputes today's `daily_kpi_snapshots` row incrementally from the day's audit events **And** UPSERTs keyed on `(customer_marketplace_id, channel_code, date=today)` **And** `refreshed_at` is updated so Story 8.2 can show "Atualização há 3min" if needed.

---

### Story 9.3: 5-surface query endpoints — `/audit` root with Daily summary + Atenção feed + Notável feed
- **Trace:** Implements UX-DR7 (daily summary), UX-DR8 (Atenção feed expanded by default), UX-DR9 (Notável feed collapsed-by-default), UX-DR12 (every event accessible via search/firehose); FRs FR37, FR38, FR38b, FR38d; NFRs NFR-P8, NFR-A3, NFR-L1. Size L.
- **Bob-trace:** SSoT: `app/src/routes/audit/index.js` (`GET /audit`), `app/src/routes/audit/_fragments/atencao-feed.js`, `app/src/routes/audit/_fragments/notavel-feed.js`, `app/src/views/pages/audit.eta`, `app/src/views/components/audit-feeds.eta`, `shared/audit/readers.js` (query helpers for the 5 surfaces — single-source-of-truth for audit reads). Depends on Story 8.1 (chrome), Story 9.0 + Story 9.1 (audit foundation), Story 9.2 (daily_kpi_snapshots for the summary card). Enables Story 9.4 (search), Story 9.5 (firehose), Story 8.10 admin reuse via `?as_admin=`.
- **Pattern A/B/C contract:**
  - Behavior: FR37, FR38, FR38b, FR38d; UX-DR7, UX-DR8, UX-DR9, UX-DR12
  - Structure: UX skeleton §4.1.1-4.1.3
  - Visual: Pattern A — `screens/06-audit-log-root.html` per the screen→stub mapping appendix.
- **Acceptance Criteria:**
  1. **Given** the route `GET /audit` **When** an authenticated customer visits **Then** the page renders 3 surfaces stacked per UX skeleton §4.1:
      1. **Daily summary card** at top (UX-DR7): aggregate counts from `daily_kpi_snapshots` today's row + position deltas vs yesterday; counts are clickable links that filter the Notável feed (e.g., clicking "12 absorções ERP" → filters Notável to `external-change-absorbed` for today)
      2. **Atenção feed** (UX-DR8): events from AD20 Atenção set (anomaly-freeze, circuit-breaker-trip, circuit-breaker-per-sku-trip, key-validation-fail, pri01-fail-persistent, payment-failure-pause, shop-name-collision-detected) where `resolved_at IS NULL`, last 30 days, ORDER BY created_at DESC LIMIT 50; rendered EXPANDED by default (UX-DR8); when 0 items: green confirmation copy *"Nada que precise da tua atenção."*
      3. **Notável feed** (UX-DR9): events from AD20 Notável set, last 30 days, ORDER BY created_at DESC LIMIT 30 (capped); rendered COLLAPSED by default (one-line summary), expand on click; "Ver todos" link → firehose-filtered
  2. **Given** UX-DR9 per-channel filter chip pinned above Notável feed (PT · ES · Ambos) **When** the customer clicks a chip **Then** the feed re-queries with the channel filter applied **And** the filter persists in URL (`?channel=PT`) for shareable / bookmarkable views.
  3. **Given** HTMX-ready fragment endpoints per architecture's URL convention **When** the Notável feed needs to re-render (e.g., filter change) **Then** `GET /audit/_fragments/notavel-feed?channel=PT` returns a discrete HTML fragment (not a full page) **And** same for `GET /audit/_fragments/atencao-feed` **And** at MVP these are full-page reloads (no HTMX library); the URL convention is reserved so Phase 2 HTMX upgrade is a configuration change.
  4. **Given** UX-DR12 (every event accessible) **When** the customer needs to find a Rotina event (e.g., a specific cycle's `pri01-submit`) **Then** they go to Story 9.4 (search by SKU) OR Story 9.5 (firehose) — Rotina events are NOT in the default feeds but ARE in the storage and queryable **And** the Daily summary card includes a small "Mostrar todos os ajustes" link that navigates to Story 9.5 firehose.
  5. **Given** NFR-P8 ≤2s response on 90-day window **When** the audit query for the Atenção feed runs **Then** it hits `idx_audit_log_customer_eventtype_created` (Story 9.1) for the relevant event_types, and completes in <2s on a 50k-SKU contested catalog's 90-day audit_log **And** the Daily summary card hits `daily_kpi_snapshots` (Story 9.2's precomputed aggregate) — sub-100ms.
  6. **Given** RLS on `/audit` **When** customer A visits with a JWT scoped to customer A **Then** they only see customer A's audit events (no manual filter needed in route code — RLS does it) **And** `?as_admin={customer_B_id}` from a non-founder returns 404 per Story 1.5 (admin-auth gates the param) **And** founder admin via `?as_admin=` reads customer B's events through service-role bypass with admin-mode banner per Story 8.10.

---

### Story 9.4: Search by SKU/EAN endpoint (primary investigation primitive)
- **Trace:** Implements UX-DR10 (sticky-top search), UX-DR12 (search exposes all event types for a single SKU); FRs FR38 partial (filter by SKU/EAN); NFRs NFR-P8. Size M.
- **Bob-trace:** SSoT: `app/src/routes/audit/search.js` (`GET /audit?sku={EAN}`), `app/src/routes/audit/_fragments/search-by-sku.js`, `app/src/views/components/search-by-sku.eta`. Depends on Story 9.3 (audit chrome reused), Story 9.0 + Story 9.1. Enables Story 9.5 firehose drill-down can also expand to search-by-SKU; Story 8.7 anomaly-review modal "Ver histórico" link.
- **Pattern A/B/C contract:**
  - Behavior: FR38, FR38b; UX-DR10, UX-DR12
  - Structure: UX skeleton §4.1.4
  - Visual: Pattern A — `screens/12-audit-search-active.html` per the screen→stub mapping appendix.
- **Acceptance Criteria:**
  1. **Given** the search box on `/audit` (rendered at top per UX-DR10 sticky-top) **When** the customer types an EAN or partial product name and submits **Then** route handler resolves to the matching sku_id via:
      - If EAN matches `skus.ean` (12-13 digit numeric) → exact match
      - Otherwise → ILIKE on `skus.product_title` returning top 5 candidates with disambiguation list
  2. **Given** an exact SKU match **When** the route renders results **Then** it shows ALL events (Atenção + Notável + Rotina — UX-DR10 / UX-DR12) for that one SKU in chronological order (most recent first), within the active date range (default last 90 days) **And** each event shows: timestamp, event_type label, scope (channel if applicable), structured payload data formatted via PT helpers (e.g., `external-change-absorbed` shows previous + new + deviation%) **And** the result page replaces the 3 stacked surfaces (Daily summary + Atenção + Notável) — search-result view is the primary view when active.
  3. **Given** date-range filter per UX skeleton §3.5 **When** the customer opens the date-range popover **Then** quick ranges: Hoje · Últimos 7 · Últimos 30 · Últimos 90 · Personalizado **And** ranges >90 days show warning *"Filtros >90 dias podem demorar mais"* (per UX skeleton §3.5).
  4. **Given** NFR-P8 ≤2s response on 90-day window **When** the search-by-SKU query runs **Then** it hits `idx_audit_log_customer_sku_created` (Story 9.1) and completes in <2s for a 90-day window with up to ~10k events for a single SKU.
  5. **Given** UX-DR10 search is the primary investigation pattern **When** `/audit` loads with NO Atenção items (steady state — common case) **Then** the search box auto-focuses (per UX-DR10) so the customer can type immediately **And** when Atenção items > 0, the search box does NOT auto-focus (Atenção items take visual priority).
  6. **Given** the empty-result state **When** an EAN search returns 0 events **Then** the page shows *"Nenhum evento para EAN {X} nos últimos 90 dias."* (verbatim per UX skeleton §3.5).

---

### Story 9.5: Firehose `/audit/firehose` — cycle-aggregated view with lazy-loaded SKU expansion
- **Trace:** Implements UX-DR11 (opt-in, paginated 50/page), UX-DR12 (firehose preserves trust property); FRs FR37, FR38c (cycle-aggregated NOT flat); NFRs NFR-P8. Size M.
- **Bob-trace:** SSoT: `app/src/routes/audit/firehose.js` (`GET /audit/firehose`), `app/src/views/pages/audit-firehose.eta`. Depends on Story 9.3 (audit chrome), Story 9.2 (cycle_summaries — firehose root reads this; SKU expansion lazy-loads from audit_log). Enables customer can verify "show me everything" trust property on demand.
- **Pattern A/B/C contract:**
  - Behavior: FR37, FR38c; UX-DR11, UX-DR12
  - Structure: UX skeleton §4.1.5
  - Visual: Pattern A — `screens/06b-audit-log-firehose.html` per the screen→stub mapping appendix.
- **Acceptance Criteria:**
  1. **Given** the route `GET /audit/firehose` **When** the customer clicks "Mostrar todos os ajustes" link from the Daily summary card OR navigates directly **Then** the page renders cycle rows (NOT individual events) — one row per cycle showing aggregate counts per UX skeleton §4.1.5:
      ```
      03:14 ciclo (Tier 1 + Tier 2a — 47 ações)              ▾
        ↓ 43 undercuts · preço médio: -€2,14
        ↑ 4 aumentos · preço médio: +€1,87
        ⏸ 12 holds · 3 abaixo do floor, 9 já em 1.º
        [Expandir SKUs ▸]
      ```
    **And** data comes from `cycle_summaries` (Story 9.2) — sub-100ms even on 90-day windows **And** UX-DR11 pagination: 50 cycles per page; "Próxima página →" link.
  2. **Given** the customer clicks "Expandir SKUs ▸" on a cycle row **When** the lazy-load fires **Then** an HTMX-ready fragment endpoint (`GET /audit/firehose/cycle/:cycleId/skus`) returns the per-SKU detail for that cycle: each SKU row shows decision (UNDERCUT / CEILING_RAISE / HOLD) + competitor context + tolerance band **And** the SKU expansion query uses `idx_audit_log_customer_cycle` (Story 9.1) **And** drill-down past the SKU level → individual events for that (cycle_id, sku_id) tuple.
  3. **Given** UX-DR11 firehose is opt-in **When** I inspect the dashboard root and `/audit` root **Then** the firehose surface is NOT visible by default; access only via the explicit "Mostrar todos os ajustes" link OR direct URL navigation **And** mobile bundle excludes the firehose entirely (UX-DR27 — lazy-loaded only when explicitly requested).
  4. **Given** UX-DR12 trust property **When** the firehose drill-down expands per-SKU **Then** EVERY event for that (cycle_id, sku_id) is rendered (Atenção + Notável + Rotina) — the firehose is the "show me everything" surface.

---

### Story 9.6: Audit-log archive job — detach old partitions per AD19 retention semantics
- **Trace:** Implements AD19 (archive policy), Pedro's audit_log retention clarification (T+7d hard delete: zero fiscal-evidence exceptions; all rows wiped — fiscal evidence lives in `moloni_invoices`); FRs FR4 + NFR-S6 retention. Size S.
- **Bob-trace:** SSoT: `worker/src/jobs/audit-log-archive.js`. Depends on Story 9.1 (partitioned base table), Story 10.1 (deletion grace cron — coordinated retention). Enables long-term storage management without manual ops.
- **Acceptance Criteria:**
  1. **Given** `worker/src/jobs/audit-log-archive.js` registered with `node-cron` to run on the 1st of each month at 03:00 Lisbon (`0 3 1 * *`) **When** the cron tick fires **Then** the job iterates partitions older than 90 days **And** for each old partition: COPYs Atenção rows to a long-term archive table (`audit_log_atencao_archive` — single non-partitioned table per architecture's intent) **And** detaches the partition from the parent (`ALTER TABLE audit_log DETACH PARTITION audit_log_<YYYY>_<MM>`) **And** retains Atenção via the archive copy; drops Notável + Rotina from the detached partition (or archives them to S3-equivalent — Bob picks; at MVP simplest is in-DB archive table) **And** logs at `info` level via pino with stats (rows archived, rows dropped, partition detached).
  2. **Given** the FR4 deletion at T+7d hard-delete (Story 10.3) **When** the deletion cron processes an account **Then** ALL audit_log rows for that customer_marketplace_id are wiped — including the Atenção archive (since the architectural retention rationale is "customer-account lifetime"; once the account is hard-deleted, retention ends) **And** zero rows are retained as "fiscal evidence" — fiscal evidence lives in `moloni_invoices` (separate table per AD22, separate retention per Portuguese fiscal law) **And** an integration test asserts: simulate a deletion at T+7d → query `audit_log` + `audit_log_atencao_archive` for the customer_marketplace_id → 0 rows in both.
  3. **Given** the archive job is non-disruptive **When** it runs during normal operations **Then** it doesn't lock active partitions (only detaches partitions older than 90 days) **And** ongoing INSERTs to current month's partition are unaffected.

---

## Epic 10: Account Deletion & Grace

**Goal.** 4-step deletion flow — (1) settings page; (2) modal requires typing `ELIMINAR` + email; (3) confirmation email + 7-day grace (cron paused, dashboard locked, banner with cancel button, cancel-mid-grace returns to DRY_RUN — must re-enter Stripe to reactivate); (4) T+7d hard-delete cron. **Encrypted shop_api_key destroyed at INITIATION, not grace-end** (security commitment "the moment you say delete me, the key is gone"). Stripe subscription cancels via `cancel_at_period_end=true`. Moloni invoice metadata retained (fiscal record).

**Coverage:** FR4 amended; NFR-S1 (encrypted-key destruction at initiation), NFR-S6. AD21. UX-DRs: UX-DR35, UX-DR36, UX-DR37.

---

### Story 10.1: `/settings/delete` multi-step initiation + ELIMINAR phrase + key destruction at INITIATION + Stripe `cancel_at_period_end`
- **Trace:** Implements AD21 (initiation half); FRs FR4 amended (steps 1-3); NFRs NFR-S1 (encrypted key destruction at initiation as security commitment), NFR-S6. Size L.
- **Atomicity:** Bundle B — multi-step deletion + Stripe `cancel_at_period_end` + key destruction must happen in ONE transaction (atomicity invariant).
- **Bob-trace:** SSoT: `app/src/routes/settings/delete.js` (multi-step routes), `app/src/views/pages/settings-delete.eta` (Step 1 page), `app/src/views/modals/delete-confirm.eta` (Step 2 ELIMINAR + email modal), `public/js/delete-account.js` (client-side ELIMINAR phrase validation). No new migrations (uses existing `customers.deletion_initiated_at` + `deletion_scheduled_at` + `customer_marketplaces.cron_state` enum). Depends on Story 1.2 (envelope encryption — for vault destruction), Story 4.1 (`PAUSED_BY_ACCOUNT_GRACE_PERIOD` cron_state value), Story 4.6 (`shared/resend/client.js` for confirmation email — Story 12.2 extends with PT template), Story 8.11 (settings sectioned navigation surfaces `/settings/delete`), Story 11.1 (`cancelSubscriptionAtPeriodEnd` helper), Story 9.0 + Story 9.1 (audit foundation — note: `(ACTIVE → PAUSED_BY_ACCOUNT_GRACE_PERIOD)` is in `LEGAL_CRON_TRANSITIONS` but NOT in the per-(from,to) audit event map per Story 4.1, so no audit event fires on deletion-initiation transition; the customer-visible signal is the email + grace banner). Enables Stories 10.2 (cancel-mid-grace), 10.3 (T+7d hard-delete cron).
- **Pattern A/B/C contract:**
  - Behavior: FR4 amended; NFR-S1; UX-DR35
  - Structure: UX skeleton §8.4 + §9.12
  - Visual: Pattern A — `screens/23-settings-delete-step1.html` (warning page) and `screens/24-delete-confirm-modal.html` (Step 2 modal) per the screen→stub mapping appendix.
- **Acceptance Criteria:**
  1. **Given** the route `GET /settings/delete` (Step 1) **When** an authenticated customer visits **Then** the page renders verbatim §8.4 Step 1 copy: warning header + "what gets wiped" list (encrypted key destroyed at initiation, catalog snapshot, baselines, audit log, all margin configs) + "what stays" list (Moloni invoice metadata as fiscal record per AD22) + "Continuar com a eliminação" button **And** the page is keyboard-accessible (NFR-A2); back-button navigates to `/settings/account` cleanly.
  2. **Given** the customer clicks "Continuar" **When** the Step 2 modal opens (`app/src/views/modals/delete-confirm.eta`) **Then** the modal renders verbatim §8.4 Step 2 + §9.12 Step 2 copy: "Para confirmar, escreve ELIMINAR e o teu email:" + two text inputs + [Cancelar] [Iniciar eliminação] buttons **And** the "Iniciar eliminação" button is disabled until BOTH inputs match: ELIMINAR (case-sensitive exact) AND the customer's email (case-insensitive exact match against `customers.email`) **And** client-side validation in `public/js/delete-account.js` enforces this; server-side re-validates on POST.
  3. **Given** the customer submits with both fields valid (Step 3) **When** `POST /settings/delete/confirm` runs **Then** in ONE transaction (via shared/db/tx.js):
      1. **Destroy encrypted key**: UPDATE `shop_api_key_vault` SET `ciphertext = NULL, nonce = NULL, auth_tag = NULL` WHERE `customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = $1)` — security commitment per AD21 + NFR-S1; the vault row exists for audit but the cryptographic material is gone (acceptable Bob alternative: DELETE the row entirely — choice is documented in Story 10.1's PR)
      2. **Transition cron_state for ALL customer's marketplaces**: for each marketplace, `transitionCronState({tx, from: <current>, to: 'PAUSED_BY_ACCOUNT_GRACE_PERIOD'})` — this `(from, to)` is in `LEGAL_CRON_TRANSITIONS` but NOT in the per-(from,to) audit event map (no audit event)
      3. **Persist deletion timestamps**: UPDATE `customers` SET `deletion_initiated_at = NOW(), deletion_scheduled_at = NOW() + INTERVAL '7 days'` WHERE `id = $1`
      4. **Cancel Stripe subscription**: call `shared/stripe/subscriptions.js`'s `cancelSubscriptionAtPeriodEnd({customerId})` (Story 11.1) — Stripe stops renewing at end of current billing period; NO automatic refund for grace-period days
      5. **Send confirmation email** via `shared/resend/client.js` (Story 4.6 + Story 12.2 extension) using template `deletion-confirmation.eta` with magic-link URL containing a signed token: `https://app.marketpilot.pt/settings/cancel-deletion?token=<signed_token>`
      6. **Lock dashboard** (subsequent dashboard renders show grace-period read-only banner per UX-DR36 + §9.12 — Story 10.2 surface)
    **And** the route returns a Step 3 toast per §9.12: *"Eliminação agendada para {date_T+7}. Tens 7 dias para mudar de ideias..."*
  4. **Given** any step in the transaction throws **When** the failure is caught **Then** the transaction rolls back — partial-state recovery is impossible **And** the route returns a generic 500 with PT-localized error **And** the customer's account is unchanged (no key destruction, no cron_state transition, no Stripe call — atomicity invariant).
  5. **Given** the customer has multiple marketplaces (e.g., Tony @ You Get with 5) **When** deletion is initiated **Then** ALL marketplaces transition to `PAUSED_BY_ACCOUNT_GRACE_PERIOD` (per AD21 — cron paused for all) **And** Stripe Subscription is canceled at period end (one Subscription per customer per F2 — covers all SubscriptionItems).
  6. **Given** an integration test **When** I run `tests/integration/deletion-initiation.test.js` **Then** it covers: happy-path initiation → all 5 transactional steps complete; key destruction verified (vault row's ciphertext IS NULL); cron_state transitions verified for ALL customer's marketplaces; Stripe API mock receives cancelSubscription call with cancel_at_period_end=true; confirmation email sent (mock Resend received it); deletion_initiated_at set on customers; rollback on failure leaves zero changes.

---

### Story 10.2: Cancel-mid-grace flow (magic link in email + dashboard "Cancelar eliminação" banner button)
- **Trace:** Implements AD21 (cancel-mid-grace half), UX-DR36 (grace banner with cancel button), UX-DR37 (magic link in confirmation email); FRs FR4 amended (cancel during grace). Size M.
- **Bob-trace:** SSoT: `app/src/routes/settings/cancel-deletion.js`, `app/src/views/pages/cancel-deletion-confirm.eta`, magic-link signed-token verification helper in `app/src/lib/signed-tokens.js`. Depends on Story 10.1 (sets deletion_initiated_at + sends email with magic link), Story 8.8 (banner library renders the grace banner with cancel button). Enables customer can abort deletion mid-grace via email link OR dashboard banner.
- **Pattern A/B/C contract:**
  - Behavior: FR4 amended; UX-DR36, UX-DR37
  - Structure: UX skeleton §8.4
  - Visual: Pattern A — grace banner rendered within `screens/22-grace-period-banner.html` per the screen→stub mapping appendix; cancel-deletion confirmation page at `screens/25-cancel-deletion-confirm.html`.
- **Acceptance Criteria:**
  1. **Given** the magic-link URL `https://app.marketpilot.pt/settings/cancel-deletion?token=<signed_token>` **When** the customer clicks it **Then** the route verifies the signed token (HMAC-signed with a server-side secret in env; payload includes customer_id + deletion_initiated_at; expires at deletion_scheduled_at) **And** if token is valid AND the customer's `customers.deletion_initiated_at IS NOT NULL` (deletion still pending) → renders the cancel-deletion confirmation page **And** if token is invalid OR expired → renders an error page with link to `/login`.
  2. **Given** the dashboard banner per UX-DR36 + §9.12 ("Conta em eliminação · Faltam {N} dia(s)") **When** the customer clicks "Cancelar eliminação" **Then** the same `POST /settings/cancel-deletion` runs (without token — uses session auth).
  3. **Given** `POST /settings/cancel-deletion` **When** the route runs **Then** in ONE transaction:
      1. UPDATE `customers` SET `deletion_initiated_at = NULL, deletion_scheduled_at = NULL` WHERE `id = $1`
      2. For each customer_marketplace: `transitionCronState({tx, from: 'PAUSED_BY_ACCOUNT_GRACE_PERIOD', to: 'DRY_RUN'})` — NOT directly to `'ACTIVE'` per AD21 (customer must re-enter Stripe payment to reactivate, since the prior Subscription is already canceling)
      3. **NOTE:** Stripe subscription is already canceling (cancel_at_period_end=true was set at initiation per Story 10.1) — cancel-mid-grace does NOT auto-reactivate Stripe; the customer must visit `/settings/billing` and re-enter Stripe payment from scratch (Story 11.3) to flip back to ACTIVE
      4. **NOTE:** The encrypted key was destroyed at initiation (Story 10.1) — the customer must visit `/onboarding/key` (rotation flow per UX-DR31) to re-validate a key before the engine can run; the existing catalog snapshot + baselines + sku_channels are retained (CASCADE was NOT run since customer_marketplaces still exist; only the vault row's ciphertext was nulled)
      5. Send "Eliminação cancelada" confirmation email via `shared/resend/client.js`
  4. **Given** the post-cancel state **When** the customer logs in after canceling **Then** the dashboard renders in DRY_RUN state (per Story 8.1's state-aware view) **And** UX-DR3 interception logic recognizes the state — customer sees the dry-run banner + minimal dashboard (catalog snapshot retained but engine cannot run without a key) **And** the customer is gently guided to either (a) re-enter the Worten key via /onboarding/key (rotation flow) or (b) re-enter Stripe payment via /settings/billing — both gates must be re-satisfied to reach ACTIVE.
  5. **Given** an integration test **When** I run `tests/integration/cancel-mid-grace.test.js` **Then** it covers: magic-link path with valid token → state restored to DRY_RUN; magic-link path with expired/invalid token → error page; dashboard-banner path with session auth → same restoration; cron_state transitions for ALL marketplaces back to DRY_RUN; deletion timestamps cleared; encrypted key remains destroyed (NOT auto-restored).

---

### Story 10.3: Daily deletion-grace cron (day-5 reminder email + T+7d hard-delete with audit-log archive coordination)
- **Trace:** Implements AD21 (T+7d hard-delete + day-5 reminder), Pedro's clarification (zero fiscal-evidence exceptions on audit_log; all wiped — fiscal evidence lives in `moloni_invoices` only); FRs FR4 amended (steps 4 + reminder). Size M.
- **Bob-trace:** SSoT: `worker/src/jobs/deletion-grace.js`. Migration: `db/migrations/202604301216_add_day5_reminder_sent_at_to_customers.sql` (adds `day5_reminder_sent_at timestamptz` column to `customers` for idempotency tracking; per N1 audit refinement — column referenced by Pass 1 below was missing from Story 1.4's customers schema). Depends on Story 10.1 (`customers.deletion_scheduled_at` set), Story 4.6 (`shared/resend/client.js` — extended by Story 12.2 templates `deletion-grace-reminder.eta` + `deletion-final.eta`), Story 9.6 (audit-log archive — coordinated retention; hard-delete wipes `audit_log_atencao_archive` rows too). Enables account fully deleted at grace-period end with no orphan data.
- **Acceptance Criteria:**
  1. **Given** `worker/src/jobs/deletion-grace.js` registered with `node-cron` to run daily at 00:30 Lisbon (`30 0 * * *` — staggered from Story 9.1's 02:00 partition cron and Story 9.6's 03:00 archive cron) **When** the cron tick fires **Then** it runs two passes:
      
      **Pass 1 — Day-5 reminder:**
      - SELECT customers WHERE `deletion_initiated_at <= NOW() - INTERVAL '5 days' AND deletion_initiated_at > NOW() - INTERVAL '6 days'` (window catches accounts at exactly day 5)
      - For each match: send PT-localized reminder email via `shared/resend/client.js` using template `deletion-grace-reminder.eta` (Story 12.2) with copy *"Faltam 2 dias para a eliminação..."*
      - Idempotent: a flag column `customers.day5_reminder_sent_at timestamptz` is set on first send so re-runs don't re-send
      
      **Pass 2 — T+7d hard-delete:**
      - SELECT customers WHERE `deletion_scheduled_at <= NOW()` (grace period elapsed)
      - For each match: in ONE transaction (per customer):
        1. **Wipe audit_log + Atenção archive**: DELETE FROM `audit_log` WHERE `customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = $1)`; DELETE FROM `audit_log_atencao_archive` WHERE same predicate (per Story 9.6 coordination — zero fiscal exceptions)
        2. **Wipe customer data via FK CASCADE**: DELETE FROM `customer_marketplaces` WHERE `customer_id = $1` — cascades to `sku_channels` → `skus` → `baseline_snapshots` → `scan_jobs` → `pri01_staging` → `shop_api_key_vault` (already nulled at initiation; row deleted now) → `cycle_summaries` → `daily_kpi_snapshots`
        3. **RETAIN moloni_invoices**: this table has no CASCADE from customers (FK is `ON DELETE NO ACTION` — fiscal record preserved per AD22 statutory retention)
        4. **Wipe Stripe references**: UPDATE `customers` SET `stripe_customer_id = NULL, stripe_subscription_id = NULL` (the actual Stripe Customer + Subscription are already canceled at period-end via Story 10.1's cancel_at_period_end; we just clear our local references)
        5. **Wipe auth.users via Supabase Admin API**: call `supabase.auth.admin.deleteUser(customer.id)` — this cascades to `customers` + `customer_profiles` rows via FK `ON DELETE CASCADE`
        6. **Send final-deletion confirmation email** to the customer's email (LAST action before the customer record is gone — uses email from local snapshot before it's wiped) via template `deletion-final.eta`
      - Each deletion is its own transaction — one customer's failure doesn't roll back others
      - Idempotent: completed deletions are gone; re-running the cron skips them naturally (their rows no longer exist)
  2. **Given** the audit-log retention semantic per Pedro's clarification **When** Pass 2 runs **Then** ZERO `audit_log` rows are retained as "fiscal evidence" — the FR4 amended retention says all entries get wiped; fiscal evidence lives in `moloni_invoices` (separate table per AD22, separate retention per Portuguese fiscal law) **And** the `audit_log_atencao_archive` table (Story 9.6's long-term Atenção archive) is also wiped for this customer **And** `moloni_invoices` rows for this customer are PRESERVED (verified post-deletion: `SELECT COUNT(*) FROM moloni_invoices WHERE customer_id = $1` > 0 if they had invoices).
  3. **Given** an integration test **When** I run `tests/integration/deletion-grace-cron.test.js` **Then** it covers:
      - Day-5 reminder: customer at exactly day 5 receives email; customer at day 6+ is NOT re-sent (idempotency); customer at day 4 is NOT yet sent
      - T+7d hard-delete: at exactly day 7+, all customer data wiped except moloni_invoices; auth.users deleted; final email sent
      - Coordinated retention: audit_log_atencao_archive wiped alongside audit_log
      - Concurrent runs: two simultaneous cron ticks don't double-process the same customer (DB-level row-locking)
