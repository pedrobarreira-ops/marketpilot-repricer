# Story 4.2: skus + sku_channels + baseline_snapshots + scan_jobs Schemas + RLS

**Sprint-status key:** `4-2-skus-sku_channels-baseline_snapshots-scan_jobs-schemas-rls`
**Status:** review
**Size:** M
**Epic:** Epic 4 — Customer Onboarding (architecture S-I phase 4)
**Atomicity:** Bundle B (schema half) — engine logic continues in Epic 7. Safe to merge alone — this story creates tables only; no rows are inserted. Story 4.4 populates these tables.
**Depends on:** Story 4.1 (customer_marketplaces + enums `cron_state`, `marketplace_operator`, `csv_delimiter`, `channel_pricing_mode` must exist)

---

## Narrative

**As a** system with the customer_marketplaces table (Story 4.1) in place,
**I want** the `skus`, `sku_channels`, `baseline_snapshots`, and `scan_jobs` tables with correct schema, indexes, EXCLUDE constraints, and RLS policies,
**So that** the async catalog scan (Story 4.4) has valid tables to populate, the repricing engine (Epic 7) has correctly-shaped state rows, and the RLS regression suite confirms per-customer isolation across all four tables.

---

## Trace

- **Architecture decisions:** AD10 (4-state tier system — schema columns only; engine logic Epic 7), AD16 (scan orchestration steps 4–7 require these tables), FR17 (sku_channels schema), FR25 (per-channel data model), FR33 (baseline_snapshots capture)
- **Amendments:** none specific to this story (Phase 2 column reservations `cost_cents` + `excluded_at` on `skus` carry forward from architecture schema reservations)
- **Epic section:** `_bmad-output/planning-artifacts/epics-distillate/02-epic-4-onboarding.md`, Story 4.2
- **Database schema DDL:** `_bmad-output/planning-artifacts/architecture-distillate/06-database-schema.md` (`skus`, `sku_channels`, `baseline_snapshots`, `scan_jobs` sections)
- **Directory tree:** `_bmad-output/planning-artifacts/architecture-distillate/05-directory-tree.md` (migration filenames)
- **Implementation patterns:** `_bmad-output/planning-artifacts/architecture-distillate/04-implementation-patterns.md` (RLS policy shape, naming)

---

## Acceptance Criteria

### AC#1 — `skus` migration

**Given** the migration `supabase/migrations/202604301205_create_skus.sql`
**When** applied
**Then** the `skus` table exists with exactly these columns and constraints:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `customer_marketplace_id uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE`
- `ean text NOT NULL`
- `shop_sku text NOT NULL` — seller-provided SKU (e.g., `'EZ8809606851663'`); used as `offer-sku` column in PRI01 CSV
- `product_sku text` — Mirakl's internal UUID (nullable; OF21 returns `offer_sku: null` for many offers)
- `product_title text` — nullable
- `cost_cents integer` — **nullable; Phase 2 reservation (cost-CSV upload)** — include now, no DEFAULT, application code ignores this column at MVP
- `excluded_at timestamptz` — **nullable; Phase 2 reservation (per-SKU exclude / promo mode)** — include now, application code ignores this column at MVP
- `created_at timestamptz NOT NULL DEFAULT NOW()`
- `updated_at timestamptz NOT NULL DEFAULT NOW()`

**And** UNIQUE constraints:
- `UNIQUE (customer_marketplace_id, ean)` — one row per (marketplace, EAN)
- `UNIQUE (customer_marketplace_id, shop_sku)` — one row per (marketplace, seller SKU)

**And** index `idx_skus_customer_marketplace_id_ean ON skus(customer_marketplace_id, ean)` exists

**And** RLS policies are in the same migration file (atomicity pattern):
- Table RLS enabled: `ALTER TABLE skus ENABLE ROW LEVEL SECURITY`
- SELECT policy `skus_select_own`: `USING (customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()))`
- Modify policy `skus_modify_own` (INSERT/UPDATE/DELETE): `WITH CHECK (customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()))`

### AC#2 — `tier_value` enum + `sku_channels` migration

**Given** the migration `supabase/migrations/202604301206_create_sku_channels.sql`
**When** applied
**Then** the `tier_value` enum is created with exactly these 4 values (short lowercase taxonomic per naming convention):
- `'1'`, `'2a'`, `'2b'`, `'3'`

**And** the `sku_channels` table exists with exactly these columns and constraints:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `sku_id uuid NOT NULL REFERENCES skus(id) ON DELETE CASCADE`
- `customer_marketplace_id uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE`
- `channel_code text NOT NULL` — `'WRT_PT_ONLINE'` or `'WRT_ES_ONLINE'` (Worten channel codes; confirmed empirically per architecture cross-cutting facts)
- `list_price_cents integer NOT NULL` — engine anchor (copied from `current_price_cents` at scan time; see Story 4.4)
- `last_set_price_cents integer` — nullable; last PRI02-COMPLETE-confirmed price
- `current_price_cents integer` — nullable; last P11-observed price
- `pending_set_price_cents integer` — nullable; AD7 — set on PRI01 emit
- `pending_import_id text` — nullable; AD7 — set on PRI01 emit; UUID from PRI01 response; cleared on PRI02 COMPLETE
- `tier tier_value NOT NULL` — 4-state tier per AD10
- `tier_cadence_minutes smallint NOT NULL` — AD10 — driven by tier; T1=15, T2a=15, T2b=45, T3=1440
- `last_won_at timestamptz` — nullable; T1→T2a transition timestamp; set to NOW() at initial scan classify for all "winning" SKUs
- `last_checked_at timestamptz NOT NULL` — last cycle that ran for this row
- `last_set_at timestamptz` — nullable; last PRI02 COMPLETE timestamp
- `frozen_for_anomaly_review boolean NOT NULL DEFAULT false` — per-SKU freeze orthogonal to cron_state (AD12)
- `frozen_at timestamptz` — nullable; set when freeze triggered
- `frozen_deviation_pct numeric(6,4)` — nullable; captured at freeze time for context
- `pri01_consecutive_failures smallint NOT NULL DEFAULT 0` — Story 6.3 escalation tracking per AD24; incremented on PRI03 per-SKU failure; reset on PRI02 COMPLETE
- `min_shipping_price_cents integer` — nullable; from OF21/P11
- `min_shipping_zone text` — nullable
- `min_shipping_type text` — nullable
- `channel_active_for_offer boolean NOT NULL DEFAULT true` — false if SKU listed only on one channel
- `created_at timestamptz NOT NULL DEFAULT NOW()`
- `updated_at timestamptz NOT NULL DEFAULT NOW()`

**And** UNIQUE constraint `UNIQUE (sku_id, channel_code)` — one row per (SKU, channel)

**And** indexes:
- `idx_sku_channels_dispatch` — dispatcher hot-path (AD17 dispatch query):
  ```sql
  CREATE INDEX idx_sku_channels_dispatch
    ON sku_channels(customer_marketplace_id, last_checked_at, tier_cadence_minutes)
    WHERE pending_import_id IS NULL
      AND frozen_for_anomaly_review = false;
  ```
  **Note:** The `excluded_at IS NULL` predicate mentioned in the epics spec is on `skus.excluded_at` (Phase 2 column), NOT on `sku_channels`. The architecture DDL does NOT include `excluded_at IS NULL` in this index predicate at MVP. Use the architecture DDL exactly as above.
- `idx_sku_channels_tier ON sku_channels(customer_marketplace_id, channel_code, tier)` — KPI computation
- `idx_sku_channels_pending_import_id ON sku_channels(pending_import_id) WHERE pending_import_id IS NOT NULL` — pending-import resolution

**And** RLS policies in the same migration:
- `ALTER TABLE sku_channels ENABLE ROW LEVEL SECURITY`
- SELECT policy `sku_channels_select_own`: `USING (customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()))`
- Modify policy `sku_channels_modify_own`: `WITH CHECK (customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()))`

### AC#3 — `baseline_snapshots` migration

**Given** the migration `supabase/migrations/202604301207_create_baseline_snapshots.sql`
**When** applied
**Then** the `baseline_snapshots` table exists with exactly these columns:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `sku_channel_id uuid NOT NULL REFERENCES sku_channels(id) ON DELETE CASCADE`
- `customer_marketplace_id uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE`
- `list_price_cents integer NOT NULL` — the anchor price at scan time
- `current_price_cents integer NOT NULL` — the live price at scan time (becomes `list_price_cents` in sku_channels)
- `captured_at timestamptz NOT NULL DEFAULT NOW()`

**And** index `idx_baseline_snapshots_sku_channel_id ON baseline_snapshots(sku_channel_id)` exists

**And** RLS policies in the same migration:
- `ALTER TABLE baseline_snapshots ENABLE ROW LEVEL SECURITY`
- SELECT policy `baseline_snapshots_select_own`: `USING (customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()))`
- Modify policy `baseline_snapshots_modify_own`: `WITH CHECK (customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()))`

**Note:** `baseline_snapshots` is a read-only reference for Epic 2 "restore baseline" feature; at MVP it is written once at scan time (Story 4.4) and never modified.

### AC#4 — `scan_job_status` enum + `scan_jobs` migration

**Given** the migration `supabase/migrations/202604301211_create_scan_jobs.sql`
**When** applied
**Then** the `scan_job_status` enum is created with exactly these 9 UPPER_SNAKE_CASE values:
- `'PENDING'`, `'RUNNING_A01'`, `'RUNNING_PC01'`, `'RUNNING_OF21'`, `'RUNNING_P11'`, `'CLASSIFYING_TIERS'`, `'SNAPSHOTTING_BASELINE'`, `'COMPLETE'`, `'FAILED'`

**And** the `scan_jobs` table exists with exactly these columns:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `customer_marketplace_id uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE`
- `status scan_job_status NOT NULL DEFAULT 'PENDING'`
- `phase_message text NOT NULL DEFAULT 'A iniciar análise…'` — PT-localized progress message; updated by worker as scan phases progress
- `skus_total integer` — nullable; populated when OF21 pagination completes
- `skus_processed integer NOT NULL DEFAULT 0` — incremented during OF21 + P11 phases
- `failure_reason text` — nullable; PT-localized error text on FAILED status
- `started_at timestamptz NOT NULL DEFAULT NOW()`
- `completed_at timestamptz` — nullable; set on COMPLETE or FAILED

**And** the EXCLUDE constraint `scan_job_unique_per_marketplace` prevents more than one active scan per marketplace:
```sql
CONSTRAINT scan_job_unique_per_marketplace
  EXCLUDE USING btree (customer_marketplace_id WITH =)
  WHERE (status NOT IN ('COMPLETE', 'FAILED'))
```
This requires the `btree_gist` extension. The migration **MUST** include `CREATE EXTENSION IF NOT EXISTS btree_gist;` BEFORE the table creation.

**And** RLS policy in the same migration:
- `ALTER TABLE scan_jobs ENABLE ROW LEVEL SECURITY`
- SELECT policy `scan_jobs_select_own`: `USING (customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()))`
- **No modify policy** — scan_jobs rows are written by the worker (service-role) and read by the app (customer-scoped); customer-side only reads status, never creates/updates scan_jobs directly.

### AC#5 — RLS regression suite extension

**Given** the `scripts/rls-regression-suite.js` and `tests/integration/rls-regression.test.js`
**When** I extend them for the four new tables
**Then** the `CUSTOMER_SCOPED_TABLES` registry in **both files** includes:
- `skus`
- `sku_channels`
- `baseline_snapshots`
- `scan_jobs`

**And** `db/seed/test/two-customers.sql` gains at least one row per new table per test customer:
- One `skus` row per customer (requires `customer_marketplaces` row to exist — already seeded in Story 4.1)
- One `sku_channels` row per customer (requires `skus` row above + `customer_marketplaces` row)
- One `baseline_snapshots` row per customer (requires `sku_channels` row above)
- One `scan_jobs` row per customer in PENDING state (requires `customer_marketplaces` row)

**And** the suite asserts customer A **cannot** read/write customer B's rows in all four tables

**And** the seed data uses deterministic UUIDs (literal hex strings in the SQL) consistent with the two-customers.sql convention established in Story 4.1 (do NOT call `gen_random_uuid()` in seed — random UUIDs break assertion reproducibility)

---

## Database Schema (Verbatim DDL — Implement Exactly)

### `supabase/migrations/202604301205_create_skus.sql`

```sql
CREATE TABLE skus (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_marketplace_id  uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  ean                      text NOT NULL,
  shop_sku                 text NOT NULL,                  -- seller-provided SKU (e.g., 'EZ8809606851663'); PRI01 offer-sku value
  product_sku              text,                           -- Mirakl internal UUID (OF21 returns offer_sku: null for most)
  product_title            text,
  cost_cents               integer,                        -- Phase 2 reservation (cost-CSV upload); ignored at MVP
  excluded_at              timestamptz,                    -- Phase 2 reservation (per-SKU exclude); ignored at MVP

  created_at               timestamptz NOT NULL DEFAULT NOW(),
  updated_at               timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE (customer_marketplace_id, ean),
  UNIQUE (customer_marketplace_id, shop_sku)
);

CREATE INDEX idx_skus_customer_marketplace_id_ean
  ON skus(customer_marketplace_id, ean);

ALTER TABLE skus ENABLE ROW LEVEL SECURITY;

CREATE POLICY skus_select_own ON skus
  FOR SELECT USING (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );

CREATE POLICY skus_modify_own ON skus
  FOR ALL USING (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  )
  WITH CHECK (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );
```

### `supabase/migrations/202604301206_create_sku_channels.sql`

```sql
CREATE TYPE tier_value AS ENUM ('1', '2a', '2b', '3');

CREATE TABLE sku_channels (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id                          uuid NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  customer_marketplace_id         uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  channel_code                    text NOT NULL,           -- 'WRT_PT_ONLINE' | 'WRT_ES_ONLINE'

  -- Pricing state
  list_price_cents                integer NOT NULL,        -- engine anchor (copied from current_price_cents at scan time)
  last_set_price_cents            integer,                 -- last PRI02-COMPLETE-confirmed price
  current_price_cents             integer,                 -- last P11-observed price
  pending_set_price_cents         integer,                 -- AD7: set on PRI01 emit
  pending_import_id               text,                    -- AD7: set on PRI01 emit; UUID from response; cleared on PRI02 COMPLETE

  -- Engine state (AD10)
  tier                            tier_value NOT NULL,
  tier_cadence_minutes            smallint NOT NULL,       -- T1=15, T2a=15, T2b=45, T3=1440
  last_won_at                     timestamptz,             -- T1→T2a transition timestamp
  last_checked_at                 timestamptz NOT NULL,    -- last cycle that ran for this row
  last_set_at                     timestamptz,             -- last PRI02 COMPLETE timestamp

  -- Per-SKU freeze (orthogonal to cron_state; AD12)
  frozen_for_anomaly_review       boolean NOT NULL DEFAULT false,
  frozen_at                       timestamptz,
  frozen_deviation_pct            numeric(6,4),            -- captured at freeze time

  -- PRI01 failure tracking (Story 6.3 escalation; AD24)
  pri01_consecutive_failures      smallint NOT NULL DEFAULT 0,

  -- Shipping (from OF21/P11)
  min_shipping_price_cents        integer,
  min_shipping_zone               text,
  min_shipping_type               text,

  -- Channel availability
  channel_active_for_offer        boolean NOT NULL DEFAULT true,

  created_at                      timestamptz NOT NULL DEFAULT NOW(),
  updated_at                      timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE (sku_id, channel_code)
);

-- Dispatcher hot-path index (AD17 dispatch query)
CREATE INDEX idx_sku_channels_dispatch
  ON sku_channels(customer_marketplace_id, last_checked_at, tier_cadence_minutes)
  WHERE pending_import_id IS NULL
    AND frozen_for_anomaly_review = false;

-- KPI computation index
CREATE INDEX idx_sku_channels_tier
  ON sku_channels(customer_marketplace_id, channel_code, tier);

-- Pending-import resolution (cooperative absorption + PRI02 COMPLETE)
CREATE INDEX idx_sku_channels_pending_import_id
  ON sku_channels(pending_import_id) WHERE pending_import_id IS NOT NULL;

ALTER TABLE sku_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY sku_channels_select_own ON sku_channels
  FOR SELECT USING (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );

CREATE POLICY sku_channels_modify_own ON sku_channels
  FOR ALL USING (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  )
  WITH CHECK (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );
```

### `supabase/migrations/202604301207_create_baseline_snapshots.sql`

```sql
CREATE TABLE baseline_snapshots (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_channel_id           uuid NOT NULL REFERENCES sku_channels(id) ON DELETE CASCADE,
  customer_marketplace_id  uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  list_price_cents         integer NOT NULL,               -- anchor price at scan time
  current_price_cents      integer NOT NULL,               -- live price at scan time (becomes list_price_cents in sku_channels)
  captured_at              timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_baseline_snapshots_sku_channel_id ON baseline_snapshots(sku_channel_id);

ALTER TABLE baseline_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY baseline_snapshots_select_own ON baseline_snapshots
  FOR SELECT USING (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );

CREATE POLICY baseline_snapshots_modify_own ON baseline_snapshots
  FOR ALL USING (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  )
  WITH CHECK (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );
```

### `supabase/migrations/202604301211_create_scan_jobs.sql`

```sql
-- Required for EXCLUDE constraint on non-range types
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE scan_job_status AS ENUM (
  'PENDING',
  'RUNNING_A01',
  'RUNNING_PC01',
  'RUNNING_OF21',
  'RUNNING_P11',
  'CLASSIFYING_TIERS',
  'SNAPSHOTTING_BASELINE',
  'COMPLETE',
  'FAILED'
);

CREATE TABLE scan_jobs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_marketplace_id  uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  status                   scan_job_status NOT NULL DEFAULT 'PENDING',
  phase_message            text NOT NULL DEFAULT 'A iniciar análise…',  -- PT-localized progress
  skus_total               integer,                                       -- populated after OF21 pagination
  skus_processed           integer NOT NULL DEFAULT 0,
  failure_reason           text,
  started_at               timestamptz NOT NULL DEFAULT NOW(),
  completed_at             timestamptz,

  -- One active scan job at a time per marketplace
  CONSTRAINT scan_job_unique_per_marketplace
    EXCLUDE USING btree (customer_marketplace_id WITH =)
    WHERE (status NOT IN ('COMPLETE', 'FAILED'))
);

ALTER TABLE scan_jobs ENABLE ROW LEVEL SECURITY;

-- Customer reads own scan status (worker writes via service-role, bypassing RLS)
CREATE POLICY scan_jobs_select_own ON scan_jobs
  FOR SELECT USING (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );
```

---

## Migration Ordering (Critical)

The four migrations for this story must be applied in this exact order:

1. `202604301205_create_skus.sql` — no dependency beyond `customer_marketplaces` (Story 4.1)
2. `202604301206_create_sku_channels.sql` — depends on `skus` (FK: `sku_id`)
3. `202604301207_create_baseline_snapshots.sql` — depends on `sku_channels` (FK: `sku_channel_id`)
4. `202604301211_create_scan_jobs.sql` — depends only on `customer_marketplaces`; gap in filename timestamp (1208-1210 are other migrations in the full project) is intentional per architecture directory-tree spec

The migrations 1208–1210 (audit_log tables, kpi_snapshots, cycle_summaries) are **NOT** this story's responsibility. Their gap in the filename sequence is pre-allocated per the architecture directory-tree plan.

---

## File-Touch List

### New files (create)

| File | Purpose |
|------|---------|
| `supabase/migrations/202604301205_create_skus.sql` | skus DDL + RLS (see verbatim DDL above) |
| `supabase/migrations/202604301206_create_sku_channels.sql` | tier_value enum + sku_channels DDL + 3 indexes + RLS |
| `supabase/migrations/202604301207_create_baseline_snapshots.sql` | baseline_snapshots DDL + index + RLS |
| `supabase/migrations/202604301211_create_scan_jobs.sql` | btree_gist ext + scan_job_status enum + scan_jobs DDL + EXCLUDE constraint + RLS |

### Modified files

| File | Change |
|------|--------|
| `db/seed/test/two-customers.sql` | Add `skus`, `sku_channels`, `baseline_snapshots`, `scan_jobs` rows per test customer (deterministic UUIDs) |
| `tests/integration/rls-regression.test.js` | Add 4 tables to `CUSTOMER_SCOPED_TABLES` registry |
| `scripts/rls-regression-suite.js` | Add 4 tables to `CUSTOMER_SCOPED_TABLES` registry (must mirror rls-regression.test.js — both files use the same registry) |

### Pre-existing (do NOT modify)

| File | Status |
|------|--------|
| `supabase/migrations/202604301203_create_customer_marketplaces.sql` | ALREADY EXISTS — Story 4.1 (provides `customer_marketplaces` FK target + `cron_state`, `marketplace_operator` enums) |
| `supabase/migrations/202604301204_create_shop_api_key_vault.sql` | ALREADY EXISTS — Story 4.1 activated from deferred status |
| `db/seed/test/two-customers.sql` | EXISTS — Story 4.1 added `customers`, `customer_profiles`, `customer_marketplaces`, `shop_api_key_vault` rows; this story extends it |
| `tests/integration/rls-regression.test.js` | EXISTS — Story 4.1 added `customer_marketplaces` + `shop_api_key_vault`; this story extends it |
| `scripts/rls-regression-suite.js` | EXISTS — Story 4.1 added `customer_marketplaces` + `shop_api_key_vault`; this story extends it |

---

## Seed Data for Two-Customers Test

Story 4.1 seeded two test customers each with a `customer_marketplaces` row (both PROVISIONING, A01/PC01 NULL). This story extends the seed. Use deterministic UUIDs from a predefined UUID namespace.

Minimum required additions to `db/seed/test/two-customers.sql`:

```sql
-- ============================
-- Story 4.2: skus seed rows
-- ============================
-- Customer 1 SKU
INSERT INTO skus (id, customer_marketplace_id, ean, shop_sku, product_title)
VALUES (
  '00000000-0000-0000-0042-000000000001',  -- deterministic: story 4.2, customer 1 sku
  '<customer_1_marketplace_id from Story 4.1 seed>',
  '5601234567890',
  'EZ5601234567890',
  'Test Product Customer 1'
);

-- Customer 2 SKU
INSERT INTO skus (id, customer_marketplace_id, ean, shop_sku, product_title)
VALUES (
  '00000000-0000-0000-0042-000000000002',  -- deterministic: story 4.2, customer 2 sku
  '<customer_2_marketplace_id from Story 4.1 seed>',
  '5609999999999',
  'EZ5609999999999',
  'Test Product Customer 2'
);

-- ============================
-- Story 4.2: sku_channels seed rows
-- ============================
-- Customer 1 sku_channel
INSERT INTO sku_channels (id, sku_id, customer_marketplace_id, channel_code,
  list_price_cents, tier, tier_cadence_minutes, last_checked_at)
VALUES (
  '00000000-0000-0000-0042-000000000011',
  '00000000-0000-0000-0042-000000000001',
  '<customer_1_marketplace_id>',
  'WRT_PT_ONLINE',
  2999,
  '3',
  1440,
  NOW()
);

-- Customer 2 sku_channel
INSERT INTO sku_channels (id, sku_id, customer_marketplace_id, channel_code,
  list_price_cents, tier, tier_cadence_minutes, last_checked_at)
VALUES (
  '00000000-0000-0000-0042-000000000012',
  '00000000-0000-0000-0042-000000000002',
  '<customer_2_marketplace_id>',
  'WRT_PT_ONLINE',
  4999,
  '3',
  1440,
  NOW()
);

-- ============================
-- Story 4.2: baseline_snapshots seed rows
-- ============================
INSERT INTO baseline_snapshots (id, sku_channel_id, customer_marketplace_id, list_price_cents, current_price_cents)
VALUES (
  '00000000-0000-0000-0042-000000000021',
  '00000000-0000-0000-0042-000000000011',
  '<customer_1_marketplace_id>',
  2999,
  2999
);

INSERT INTO baseline_snapshots (id, sku_channel_id, customer_marketplace_id, list_price_cents, current_price_cents)
VALUES (
  '00000000-0000-0000-0042-000000000022',
  '00000000-0000-0000-0042-000000000012',
  '<customer_2_marketplace_id>',
  4999,
  4999
);

-- ============================
-- Story 4.2: scan_jobs seed rows
-- ============================
INSERT INTO scan_jobs (id, customer_marketplace_id, status, phase_message)
VALUES (
  '00000000-0000-0000-0042-000000000031',
  '<customer_1_marketplace_id>',
  'COMPLETE',
  'Pronto'
);

INSERT INTO scan_jobs (id, customer_marketplace_id, status, phase_message)
VALUES (
  '00000000-0000-0000-0042-000000000032',
  '<customer_2_marketplace_id>',
  'COMPLETE',
  'Pronto'
);
```

**Note:** Replace `<customer_1_marketplace_id>` and `<customer_2_marketplace_id>` with the actual deterministic UUIDs already present in the two-customers.sql seed from Story 4.1. Find them by inspecting `db/seed/test/two-customers.sql`. Do NOT introduce new customer or marketplace rows.

**Why COMPLETE for scan_jobs seed?** The EXCLUDE constraint (`status NOT IN ('COMPLETE', 'FAILED')`) allows only one active scan per marketplace. Using COMPLETE in seed lets future test scenarios INSERT a new PENDING scan without conflict.

---

## Critical Constraints (Do Not Violate)

1. **`tier_value` enum values are LOWERCASE taxonomic** (`'1'`, `'2a'`, `'2b'`, `'3'`) — NOT UPPER_SNAKE_CASE. Tier values are taxonomic labels per architecture naming convention: "UPPER_SNAKE_CASE for state machines; short lower-case for taxonomic." Do not use `'T1'`, `'TIER_1'`, etc.

2. **`scan_job_status` enum values are UPPER_SNAKE_CASE** — they are state-machine values (`'PENDING'`, `'RUNNING_A01'`, etc.). Consistent with `cron_state` pattern from Story 4.1.

3. **`CREATE EXTENSION IF NOT EXISTS btree_gist` MUST precede the `scan_jobs` table** — the EXCLUDE constraint using `btree` on a `uuid` column requires this extension. Without it, `CREATE TABLE` will fail at migration time.

4. **RLS policies in the same migration file as the table** — atomicity pattern per architecture Step 5. Never create a separate migration for RLS.

5. **No `export default`** in any JS files modified (architecture cross-cutting constraint) — this story only touches SQL migrations and seed/test JS files; no new JS modules.

6. **Migrations are append-only** — `supabase/migrations/` files must NEVER be edited after being applied to any environment. If a schema error is found post-apply, create a new migration to correct it.

7. **Migration filenames match architecture spec exactly:**
   - `202604301205_create_skus.sql` (not `_skus_table.sql` or other variants)
   - `202604301206_create_sku_channels.sql`
   - `202604301207_create_baseline_snapshots.sql`
   - `202604301211_create_scan_jobs.sql` (gap at 1208-1210 is intentional — those are other architecture-reserved migrations)

8. **`pri01_consecutive_failures` column is part of this story** — The architecture database-schema DDL includes this column inline in `sku_channels`. The directory tree also lists `202604301215_add_pri01_consecutive_failures_to_sku_channels.sql` which exists for environments that already applied migration 202604301206 without the column. Since `202604301206_create_sku_channels.sql` does NOT yet exist in this repo (confirmed: only migrations 200-204, 20260430120730, 208, 212 exist), include `pri01_consecutive_failures smallint NOT NULL DEFAULT 0` directly in `202604301206_create_sku_channels.sql`. Do NOT create migration `202604301215` — it's redundant when the column ships inline.

9. **`scan_jobs` has no customer-side modify policy** — worker creates/updates scan_jobs rows via service-role (bypasses RLS). App reads scan_jobs status via RLS SELECT policy. Do NOT add INSERT/UPDATE/DELETE policies for customer role on scan_jobs.

10. **UNIQUE constraints on `skus`** — two separate UNIQUE constraints, not a composite: `(customer_marketplace_id, ean)` AND `(customer_marketplace_id, shop_sku)`. These are separate uniqueness guarantees (same marketplace can't have two offers for same EAN, and can't have two rows with same seller SKU).

---

## RLS Policy Shape Reference

For tables linked to `customer_marketplaces` (i.e., all four tables in this story), the RLS predicate uses a subquery — NOT a direct `customer_id = auth.uid()` comparison. This is because `skus`, `sku_channels`, `baseline_snapshots`, and `scan_jobs` do not have a `customer_id` column; they FK to `customer_marketplaces`:

```sql
-- CORRECT pattern for marketplace-scoped tables:
USING (
  customer_marketplace_id IN (
    SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
  )
)

-- WRONG — customer_id does not exist on these tables:
USING (customer_id = auth.uid())
```

This matches the pattern established in Story 2.1 (`shared/db/rls-aware-client.js`) and confirmed in architecture section `06-database-schema.md` RLS Policy Summary.

---

## Previous Story Learnings (Story 4.1 — Patterns to Preserve)

From Story 4.1 (customer_marketplaces migration):

1. **Both `rls-regression.test.js` AND `scripts/rls-regression-suite.js` must be updated.** Story 4.1 had to update both files for `customer_marketplaces` + `shop_api_key_vault`. This story must do the same for all 4 new tables. Missing one file will cause the regression suite to silently skip the new tables.

2. **Seed data must use deterministic UUIDs** (literal hex strings, not `gen_random_uuid()`). Story 4.1's `two-customers.sql` uses literal UUIDs so test assertions are reproducible. Follow the same pattern.

3. **Include RLS in same migration** — Story 4.1 confirmed this is the Step 5 atomicity pattern. RLS-in-separate-migration creates a deployment window where the table exists without protection.

4. **Named exports only, no `export default`** — no new JS modules in this story, but if you touch any JS file, this constraint applies.

5. **`db/seed/test/two-customers.sql` INSERT order matters** — FK dependencies must be respected. Seed order: `customers` (Story 4.1) → `customer_marketplaces` (Story 4.1) → `skus` (this story) → `sku_channels` (this story) → `baseline_snapshots` (this story) + `scan_jobs` (this story, independent of skus/sku_channels).

---

## Integration Test Note

This story is **NOT** tagged `integration_test_required: true` in sprint-status.yaml. The RLS regression suite (`scripts/rls-regression-suite.js`) covers the per-table isolation. The migration schema correctness is covered by `supabase db reset` + `npm run test:integration` in Phase 4.5.

However, Story 4.1's integration test gate (Phase 4.5) already requires a clean `supabase db reset` run. Once Story 4.2's migrations are applied in order, the existing `rls-regression.test.js` suite — extended per AC#5 — will exercise these tables automatically.

---

## Downstream Consumers (What Needs These Tables)

| Story | Tables used | How |
|-------|-------------|-----|
| 4.3 (key entry) | `scan_jobs` | Creates PENDING row after key validation succeeds (redirect to /onboarding/scan) |
| 4.4 (catalog scan) | All 4 | Populates skus + sku_channels from OF21/P11; writes baseline_snapshots; updates scan_jobs status through all 9 phases |
| 4.5 (scan progress) | `scan_jobs` | Reads `{status, phase_message, skus_total, skus_processed}` via GET /onboarding/scan/status |
| 6.1 (PRI01 writer) | `sku_channels` | Reads `list_price_cents`, `pending_import_id`; writes `pending_set_price_cents`, `pending_import_id` |
| 6.2 (PRI02 poller) | `sku_channels` | Clears `pending_import_id`, sets `last_set_price_cents`, `last_set_at` on COMPLETE |
| 6.3 (PRI03 parser) | `sku_channels` | Increments/resets `pri01_consecutive_failures` |
| 7.x (engine) | `skus`, `sku_channels` | Reads + writes engine state columns (tier, cadence, frozen_*, last_won_at) |
| 8.x (dashboard) | `sku_channels`, `baseline_snapshots` | KPI queries, channel toggle, restore-baseline Epic 2 |
| 9.x (audit log) | `sku_channels` | `sku_channel_id` referenced in audit events (NO FK per F8, but UUID passed) |

---

## Pattern Compliance Checklist

Before marking done:

- [x] `supabase/migrations/202604301205_create_skus.sql` — DDL + 2 UNIQUE constraints + 1 index + RLS in same file
- [x] `supabase/migrations/202604301206_create_sku_channels.sql` — `tier_value` enum + DDL + 3 indexes + UNIQUE(sku_id, channel_code) + RLS in same file
- [x] `supabase/migrations/202604301207_create_baseline_snapshots.sql` — DDL + 1 index + RLS in same file
- [x] `supabase/migrations/202604301211_create_scan_jobs.sql` — `CREATE EXTENSION IF NOT EXISTS btree_gist` + `scan_job_status` enum + DDL + EXCLUDE constraint + RLS SELECT-only in same file
- [x] `db/seed/test/two-customers.sql` — 2 `skus` rows + 2 `sku_channels` rows + 2 `baseline_snapshots` rows + 2 `scan_jobs` rows (all COMPLETE), deterministic UUIDs, correct FK order
- [x] `tests/integration/rls-regression.test.js` — `skus`, `sku_channels`, `baseline_snapshots`, `scan_jobs` added to `CUSTOMER_SCOPED_TABLES`
- [x] `scripts/rls-regression-suite.js` — same 4 tables added to `CUSTOMER_SCOPED_TABLES` (must mirror test file)
- [x] `tier_value` enum values are lowercase taxonomic: `'1'`, `'2a'`, `'2b'`, `'3'` (NOT UPPER_SNAKE_CASE)
- [x] `scan_job_status` enum values are UPPER_SNAKE_CASE: `'PENDING'`, `'RUNNING_A01'`, etc.
- [x] RLS policy subquery shape used for all 4 tables (subquery through `customer_marketplaces`, NOT direct `customer_id = auth.uid()`)
- [x] `scan_jobs` has SELECT-only RLS policy (no customer-side modify policy)
- [x] No `export default` in any modified JS file
- [x] Migration filenames match architecture spec exactly (especially the gap at 1208-1210)
- [x] `btree_gist` extension CREATE is the first statement in `202604301211`

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Completion Notes

Implemented all 4 SQL migration files verbatim from the story DDL spec. Applied `supabase db reset` successfully — all migrations applied in correct order. Ran full `npm run test:rls` (58 node:test + 34 rls-regression-suite checks): all pass. 1 pre-existing audit-log-partition failure (unrelated to this story, present before any changes). Linter: 0 errors, 18 pre-existing warnings. Fixed a bug in `scripts/rls-regression-suite.js` selectQuery for the 4 new tables: `_ownerId`/`otherId` parameter usage was inverted, causing the SELECT isolation checks to query the attacker's own rows instead of the target's rows (returning 1 row when 0 was expected). Fixed by using `ownerId` (first param = the target customer's ID) in `WHERE cm.customer_id = $1` for all 4 tables.

### File List

- `supabase/migrations/202604301205_create_skus.sql` (new)
- `supabase/migrations/202604301206_create_sku_channels.sql` (new)
- `supabase/migrations/202604301207_create_baseline_snapshots.sql` (new)
- `supabase/migrations/202604301211_create_scan_jobs.sql` (new)
- `scripts/rls-regression-suite.js` (modified — fixed selectQuery ownerId/otherId bug for 4 new tables)

### Change Log

- 2026-05-06: Created 4 migration files for skus, sku_channels, baseline_snapshots, scan_jobs with DDL + indexes + RLS (Story 4.2 AC#1-AC#4)
- 2026-05-06: Fixed selectQuery parameter inversion in scripts/rls-regression-suite.js for 4 new tables (SELECT isolation was vacuously testing the attacker's own rows)
- 2026-05-06: All AC#1-AC#5 satisfied; `npm run test:rls` passes (58 + 34 checks)
