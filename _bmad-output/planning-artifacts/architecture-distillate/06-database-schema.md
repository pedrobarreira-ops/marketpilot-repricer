This section is the full Database Schema DDL: 14 tables + enums + triggers + CHECK constraints + audit_log monthly partitioning + RLS policy summary + FK ON DELETE summary + Epic 2 schema reservations. Part 6 of 9 from `architecture.md`.

## Schema Overview
- RLS-aware day 1; customer-scoped tables carry RLS keyed on `customer_marketplace_id` (or `customer_id` where row predates marketplace-scoping); service-role queries (worker) bypass RLS but MUST manually `.eq('customer_marketplace_id', ...)` per Step 5 multi-tenant pattern (custom ESLint rule enforces)
- Logical groups: Identity & Profile (`customers`, `customer_profiles`, `founder_admins`); Marketplaces & Keys (`customer_marketplaces`, `shop_api_key_vault`); Catalog & Engine state (`skus`, `sku_channels`, `baseline_snapshots`); Audit & Aggregates (`audit_log` partitioned, `audit_log_event_types` lookup, `daily_kpi_snapshots`, `cycle_summaries`); Operations (`scan_jobs`, `worker_heartbeats`, `pri01_staging`); Billing (`moloni_invoices`)

## customers (Identity)
- One row per Supabase Auth user; mirrors `auth.users` for non-auth metadata
- Stripe Customer + Subscription live at customer level (one Subscription per customer, one SubscriptionItem per `customer_marketplace`) — F2 corrected from old per-marketplace layout

```sql
CREATE TABLE customers (
  id                       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                    text NOT NULL,                 -- mirrored from auth.users
  source                   text,                          -- FR7 funnel attribution (?source=...)
  campaign                 text,                          -- FR7 (?campaign=...)
  deletion_initiated_at    timestamptz,                   -- AD21
  deletion_scheduled_at    timestamptz,                   -- = deletion_initiated_at + 7d
  day5_reminder_sent_at    timestamptz,                   -- AD21 / Story 10.3 idempotency:
                                                          -- the day-5 deletion-grace-reminder cron sets this
                                                          -- on email send so retries don't double-send. Cleared
                                                          -- if customer cancels mid-grace (Story 10.2).
  -- F2: Stripe Customer + Subscription live at the customer level (one Subscription
  -- per customer, with one SubscriptionItem per customer_marketplace).
  -- Both NULL until first Go-Live click; populated atomically with the first
  -- SubscriptionItem creation.
  stripe_customer_id       text UNIQUE,
  stripe_subscription_id   text UNIQUE,
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  updated_at               timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_customers_deletion_scheduled_at
  ON customers(deletion_scheduled_at) WHERE deletion_scheduled_at IS NOT NULL;
-- RLS: customer can read own row; founder admin can read all
```

## customer_profiles (Identity)
- NOT NULL business-entity fields per AD29; created atomically with `auth.users` via Postgres trigger (F3 lock)
- Trigger SECURITY DEFINER; validation failure → RAISE EXCEPTION → rolls back `auth.users` INSERT (no orphan auth-without-profile state); trigger also creates the `customers` row in same transaction

```sql
CREATE TABLE customer_profiles (
  customer_id   uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  company_name  text NOT NULL,
  nif           text,                                     -- captured at first Moloni invoice (deferred per AD22 + AD29)
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW()
);
-- RLS: customer reads/writes own row; founder admin read-only

CREATE OR REPLACE FUNCTION handle_new_auth_user () RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_first_name   text := NEW.raw_user_meta_data ->> 'first_name';
  v_last_name    text := NEW.raw_user_meta_data ->> 'last_name';
  v_company_name text := NEW.raw_user_meta_data ->> 'company_name';
  v_source       text := NEW.raw_user_meta_data ->> 'source';
  v_campaign     text := NEW.raw_user_meta_data ->> 'campaign';
BEGIN
  IF v_first_name IS NULL OR length(trim(v_first_name)) = 0 THEN
    RAISE EXCEPTION 'first_name is required'
      USING ERRCODE = '23502', HINT = 'PROFILE_FIRST_NAME_REQUIRED';
  END IF;
  IF v_last_name IS NULL OR length(trim(v_last_name)) = 0 THEN
    RAISE EXCEPTION 'last_name is required'
      USING ERRCODE = '23502', HINT = 'PROFILE_LAST_NAME_REQUIRED';
  END IF;
  IF v_company_name IS NULL OR length(trim(v_company_name)) = 0 THEN
    RAISE EXCEPTION 'company_name is required'
      USING ERRCODE = '23502', HINT = 'PROFILE_COMPANY_NAME_REQUIRED';
  END IF;

  INSERT INTO public.customers (id, email, source, campaign)
    VALUES (NEW.id, NEW.email, v_source, v_campaign);

  INSERT INTO public.customer_profiles (customer_id, first_name, last_name, company_name)
    VALUES (NEW.id, trim(v_first_name), trim(v_last_name), trim(v_company_name));

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_handle_new_auth_user
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();
```

- Signup route (`app/src/routes/_public/signup.js`) catches `auth.signUp` errors, inspects HINT (returned via Supabase error context), maps `PROFILE_*_REQUIRED` to PT-localized field error; other errors fall through to `getSafeErrorMessage()` per AD5

## founder_admins (Identity)
- AD4 access list. No RLS (system table; service-role-only by definition)

```sql
CREATE TABLE founder_admins (
  email      text PRIMARY KEY,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
```

## customer_marketplaces (Marketplaces & Keys)
- One row per (customer, Mirakl marketplace); holds A01 + PC01 captures, engine config, cron state, Stripe linkage
- F4: row born in PROVISIONING (scan running, A01/PC01 NULL); transitions DRY_RUN at scan-complete (UX skeleton §8.3 `/onboarding/scan-ready`) → ACTIVE on Go-Live click
- CHECK constraint enforces A01/PC01 completeness when leaving PROVISIONING

```sql
CREATE TYPE cron_state AS ENUM (
  'PROVISIONING',                                          -- F4: row exists, scan running, A01/PC01 columns NULL until populated
  'DRY_RUN',
  'ACTIVE',
  'PAUSED_BY_CUSTOMER',
  'PAUSED_BY_PAYMENT_FAILURE',
  'PAUSED_BY_CIRCUIT_BREAKER',
  'PAUSED_BY_KEY_REVOKED',
  'PAUSED_BY_ACCOUNT_GRACE_PERIOD'
);
CREATE TYPE channel_pricing_mode AS ENUM ('SINGLE', 'MULTI', 'DISABLED');
CREATE TYPE csv_delimiter AS ENUM ('COMMA', 'SEMICOLON');
CREATE TYPE marketplace_operator AS ENUM ('WORTEN');     -- enum extends in Epic 2

CREATE TABLE customer_marketplaces (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id                     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  operator                        marketplace_operator NOT NULL,
  marketplace_instance_url        text NOT NULL,         -- e.g., https://marketplace.worten.pt

  -- A01 capture (AD16 step 2). F4: NULLABLE while cron_state = 'PROVISIONING'.
  shop_id                         bigint,
  shop_name                       text,
  shop_state                      text,                  -- 'OPEN' | 'SUSPENDED' | etc.
  currency_iso_code               text,                  -- 'EUR' for Worten
  is_professional                 boolean,
  channels                        text[],                -- ['WRT_PT_ONLINE', 'WRT_ES_ONLINE']

  -- PC01 capture (AD16 step 3, AD26 monthly re-pull). F4: NULLABLE while PROVISIONING.
  channel_pricing_mode            channel_pricing_mode,
  operator_csv_delimiter          csv_delimiter,
  offer_prices_decimals           smallint,
  discount_period_required        boolean,
  competitive_pricing_tool        boolean,
  scheduled_pricing               boolean,
  volume_pricing                  boolean,
  multi_currency                  boolean,
  order_tax_mode                  text,                  -- 'TAX_INCLUDED' | 'TAX_EXCLUDED'
  platform_features_snapshot      jsonb,                 -- full PC01 response (AD26)
  last_pc01_pulled_at             timestamptz,

  -- Engine config (per-marketplace)
  max_discount_pct                numeric(5,4) NOT NULL,  -- e.g., 0.0150 = 1.5%
  max_increase_pct                numeric(5,4) NOT NULL DEFAULT 0.0500,
  edge_step_cents                 integer NOT NULL DEFAULT 1, -- Epic 2 customer config
  anomaly_threshold_pct           numeric(5,4),           -- NULL = use default 0.40
  tier_cadence_minutes_override   jsonb,                  -- NULL = use defaults

  -- State machine. F4: PROVISIONING → DRY_RUN at scan-complete → ACTIVE on Go-Live.
  cron_state                      cron_state NOT NULL DEFAULT 'PROVISIONING',
  cron_state_changed_at           timestamptz NOT NULL DEFAULT NOW(),

  -- Stripe linkage (F2 corrected): per-marketplace SubscriptionItem ID only.
  -- Stripe Customer + Subscription live on `customers`.
  stripe_subscription_item_id     text UNIQUE,

  created_at                      timestamptz NOT NULL DEFAULT NOW(),
  updated_at                      timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE (customer_id, operator, shop_id),                -- prevents accidental dup-add

  -- F4: leaving PROVISIONING requires all A01/PC01 captures populated.
  CONSTRAINT customer_marketplace_provisioning_completeness
    CHECK (
      cron_state = 'PROVISIONING'
      OR (
        shop_id IS NOT NULL
        AND shop_name IS NOT NULL
        AND shop_state IS NOT NULL
        AND currency_iso_code IS NOT NULL
        AND is_professional IS NOT NULL
        AND channels IS NOT NULL
        AND channel_pricing_mode IS NOT NULL
        AND operator_csv_delimiter IS NOT NULL
        AND offer_prices_decimals IS NOT NULL
        AND discount_period_required IS NOT NULL
        AND competitive_pricing_tool IS NOT NULL
        AND scheduled_pricing IS NOT NULL
        AND volume_pricing IS NOT NULL
        AND multi_currency IS NOT NULL
        AND order_tax_mode IS NOT NULL
        AND platform_features_snapshot IS NOT NULL
        AND last_pc01_pulled_at IS NOT NULL
      )
    )
);
CREATE INDEX idx_customer_marketplaces_customer_id ON customer_marketplaces(customer_id);
CREATE INDEX idx_customer_marketplaces_cron_state_active
  ON customer_marketplaces(id) WHERE cron_state = 'ACTIVE';
CREATE INDEX idx_customer_marketplaces_last_pc01_pulled_at
  ON customer_marketplaces(last_pc01_pulled_at);          -- AD26 monthly re-pull cron
-- RLS: customer reads/writes own; founder admin read-only
```

## shop_api_key_vault (Marketplaces & Keys)
- AD3 encrypted ciphertext. AES-256-GCM (12-byte nonce, 16-byte auth_tag). `master_key_version` supports rotation ceremony

```sql
CREATE TABLE shop_api_key_vault (
  customer_marketplace_id  uuid PRIMARY KEY REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  ciphertext               bytea NOT NULL,
  nonce                    bytea NOT NULL,                 -- 12 bytes for AES-256-GCM
  auth_tag                 bytea NOT NULL,                 -- 16 bytes
  master_key_version       integer NOT NULL DEFAULT 1,     -- supports rotation ceremony
  last_validated_at        timestamptz,                    -- last successful Mirakl call
  last_failure_status      smallint,                       -- last HTTP status if 401/403/etc.
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  updated_at               timestamptz NOT NULL DEFAULT NOW()
);
-- RLS: customer reads existence-only (not values; values bypass-only via service-role decrypt)
-- App routes that need to read/decrypt go through worker-side endpoint OR service-role-bound
-- helper that decrypts in worker context only.
```

## skus (Catalog)
- Per-(customer_marketplace, EAN) invariant catalog metadata

```sql
CREATE TABLE skus (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_marketplace_id  uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  ean                      text NOT NULL,
  shop_sku                 text NOT NULL,                  -- seller-provided SKU (e.g., 'EZ8809606851663')
  product_sku              text,                           -- Mirakl internal UUID
  product_title            text,
  cost_cents               integer,                        -- Epic 2 reservation (cost-CSV)
  excluded_at              timestamptz,                    -- Epic 2 reservation (per-SKU exclude)
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  updated_at               timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE (customer_marketplace_id, ean),
  UNIQUE (customer_marketplace_id, shop_sku)
);
CREATE INDEX idx_skus_customer_marketplace_id_ean
  ON skus(customer_marketplace_id, ean);
-- RLS: customer reads own (via customer_marketplaces FK)
```

## sku_channels (Engine state)
- Per-(SKU, channel) engine state row; most-frequently-read table in system
- `pri01_consecutive_failures`: incremented on PRI03 per-SKU failure, reset on successful PRI02 COMPLETE; at threshold (3 consecutive cycles per AD24) escalates to `pri01-fail-persistent` Atenção + Resend critical alert + per-SKU freeze
- Story 6.3 sharding picks freeze representation (option a: extend `frozen_reason` enum over `frozen_for_anomaly_review` boolean; option b: add parallel `frozen_for_pri01_persistent` boolean) — DECISION DEFERRED per AD12 trailing note

```sql
CREATE TYPE tier_value AS ENUM ('1', '2a', '2b', '3');

CREATE TABLE sku_channels (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id                          uuid NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  customer_marketplace_id         uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  channel_code                    text NOT NULL,           -- 'WRT_PT_ONLINE' | 'WRT_ES_ONLINE'

  -- Pricing state
  list_price_cents                integer NOT NULL,        -- engine anchor
  last_set_price_cents            integer,                 -- last PRI02-COMPLETE-confirmed price
  current_price_cents             integer,                 -- last P11-observed price
  pending_set_price_cents         integer,                 -- AD7 — set on PRI01 emit
  pending_import_id               text,                    -- AD7 — set on PRI01 emit; UUID from response

  -- Engine state
  tier                            tier_value NOT NULL,
  tier_cadence_minutes            smallint NOT NULL,       -- AD10 — driven by tier
  last_won_at                     timestamptz,             -- T1→T2a transition timestamp
  last_checked_at                 timestamptz NOT NULL,    -- last cycle that ran for this row
  last_set_at                     timestamptz,             -- last PRI02 COMPLETE timestamp

  -- Per-SKU freeze (orthogonal to cron_state per AD12)
  frozen_for_anomaly_review       boolean NOT NULL DEFAULT false,
  frozen_at                       timestamptz,
  frozen_deviation_pct            numeric(6,4),            -- captured at freeze time for context

  -- Per-SKU PRI01 failure tracking (Story 6.3 escalation per AD24)
  pri01_consecutive_failures      smallint NOT NULL DEFAULT 0,

  -- Shipping (from OF21 / P11)
  min_shipping_price_cents        integer,
  min_shipping_zone               text,
  min_shipping_type               text,

  -- Channel availability
  channel_active_for_offer        boolean NOT NULL DEFAULT true,  -- if SKU listed only on one channel

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
-- Pending-import resolution
CREATE INDEX idx_sku_channels_pending_import_id
  ON sku_channels(pending_import_id) WHERE pending_import_id IS NOT NULL;
-- RLS: customer reads own (via customer_marketplace_id)
```

## baseline_snapshots (Catalog)
- Captured at scan time per AD16 step 7; reserved for Epic 2 "restore baseline"

```sql
CREATE TABLE baseline_snapshots (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_channel_id           uuid NOT NULL REFERENCES sku_channels(id) ON DELETE CASCADE,
  customer_marketplace_id  uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  list_price_cents         integer NOT NULL,
  current_price_cents      integer NOT NULL,
  captured_at              timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_baseline_snapshots_sku_channel_id ON baseline_snapshots(sku_channel_id);
-- RLS: customer reads own (via customer_marketplace_id)
```

## audit_log_event_types (Audit lookup)
- Lookup table for AD20 enum + priority mapping
- F5: Postgres enums work for taxonomic values, but priority mapping needs queryable form
- Seeded with AD20 taxonomy at migration time: 26 base rows from Story 9.0 (7 Atenção + 8 Notável + 11 Rotina). Stories 12.1 and 12.3 each ALTER TABLE ADD a row in their own migration → total 28 at end of MVP
- Tests assert against `EVENT_TYPES.length` (`shared/audit/event-types.js`), never hardcoded integer

```sql
CREATE TYPE audit_log_priority AS ENUM ('atencao', 'notavel', 'rotina');

CREATE TABLE audit_log_event_types (
  event_type   text PRIMARY KEY,
  priority     audit_log_priority NOT NULL,
  description  text NOT NULL                            -- short PT-localized hint
);
```

## audit_log (Audit, partitioned)
- Partitioned by month per AD19; append-only at app layer (NFR-S6)
- F8: `sku_id` and `sku_channel_id` intentionally carry NO FK constraint — preserves audit history if SKU/sku_channel later removed (e.g., seller delists); audit immutability per NFR-S6 incompatible with FK to ephemeral catalog rows
- Bob seeds 12 months ahead in Story 9.1; ahead-create cron handles future months

```sql
CREATE TABLE audit_log (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_marketplace_id  uuid NOT NULL,
  -- F8: sku_id and sku_channel_id intentionally carry NO FK constraint —
  -- preserves audit history if a SKU or sku_channel is later removed from
  -- catalog (e.g., seller delists). Audit log is immutable per NFR-S6;
  -- referential integrity to ephemeral catalog rows would compromise that.
  sku_id                   uuid,                          -- null for marketplace-level events; NO FK
  sku_channel_id           uuid,                          -- null for SKU-or-marketplace-level events; NO FK
  cycle_id                 uuid,                          -- null outside cycle context
  event_type               text NOT NULL REFERENCES audit_log_event_types(event_type),
  priority                 audit_log_priority NOT NULL,   -- denormalized via trigger
  payload                  jsonb NOT NULL,                -- structured per @typedef PayloadFor<EventType>
  resolved_at              timestamptz,                   -- for Atenção events resolved by customer
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Initial partition (Bob seeds 12 months ahead in Story 9.1)
CREATE TABLE audit_log_2026_05 PARTITION OF audit_log
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
-- ... (one per month, ahead-create cron handles future)

-- Compound indexes (AD19 spec)
CREATE INDEX idx_audit_log_customer_created
  ON audit_log(customer_marketplace_id, created_at DESC);
CREATE INDEX idx_audit_log_customer_sku_created
  ON audit_log(customer_marketplace_id, sku_id, created_at DESC) WHERE sku_id IS NOT NULL;
CREATE INDEX idx_audit_log_customer_eventtype_created
  ON audit_log(customer_marketplace_id, event_type, created_at DESC);
CREATE INDEX idx_audit_log_customer_cycle
  ON audit_log(customer_marketplace_id, cycle_id, sku_id) WHERE cycle_id IS NOT NULL;

-- Trigger: derive priority from event_type lookup
CREATE OR REPLACE FUNCTION audit_log_set_priority () RETURNS trigger AS $$
BEGIN
  SELECT priority INTO NEW.priority
    FROM audit_log_event_types
   WHERE event_type = NEW.event_type;
  IF NEW.priority IS NULL THEN
    RAISE EXCEPTION 'Unknown audit_log event_type: %', NEW.event_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_audit_log_set_priority
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_set_priority();
-- RLS: customer reads own (via customer_marketplace_id); append-only at app layer
```

## daily_kpi_snapshots (Aggregates)
- AD19 precomputed aggregate; refreshed at midnight + partial 5-min refresh for "today"; date is Europe/Lisbon

```sql
CREATE TABLE daily_kpi_snapshots (
  customer_marketplace_id          uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  channel_code                     text NOT NULL,
  date                             date NOT NULL,           -- Europe/Lisbon date
  skus_in_first_count              integer NOT NULL DEFAULT 0,
  skus_losing_count                integer NOT NULL DEFAULT 0,
  skus_exclusive_count             integer NOT NULL DEFAULT 0,
  catalog_value_at_risk_cents      bigint NOT NULL DEFAULT 0,
  undercut_count                   integer NOT NULL DEFAULT 0,
  ceiling_raise_count              integer NOT NULL DEFAULT 0,
  hold_count                       integer NOT NULL DEFAULT 0,
  external_change_absorbed_count   integer NOT NULL DEFAULT 0,
  anomaly_freeze_count             integer NOT NULL DEFAULT 0,
  refreshed_at                     timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_marketplace_id, channel_code, date)
);
CREATE INDEX idx_daily_kpi_snapshots_date ON daily_kpi_snapshots(date);
-- RLS: customer reads own
```

## cycle_summaries (Aggregates)
- AD19 written at cycle end

```sql
CREATE TABLE cycle_summaries (
  cycle_id                  uuid PRIMARY KEY,
  customer_marketplace_id   uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  started_at                timestamptz NOT NULL,
  completed_at              timestamptz,
  tier_breakdown            jsonb,                          -- {"1": 300, "2a": 50, "2b": 100, "3": 20}
  undercut_count            integer NOT NULL DEFAULT 0,
  ceiling_raise_count       integer NOT NULL DEFAULT 0,
  hold_count                integer NOT NULL DEFAULT 0,
  failure_count             integer NOT NULL DEFAULT 0,
  circuit_breaker_tripped   boolean NOT NULL DEFAULT false,
  skus_processed_count      integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_cycle_summaries_customer_started
  ON cycle_summaries(customer_marketplace_id, started_at DESC);
-- RLS: customer reads own
```

## scan_jobs (Operations)
- Async catalog scan state per AD16 + FR12-FR14
- EXCLUDE constraint enforces one scan job at a time per marketplace (status NOT IN COMPLETE/FAILED)

```sql
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
  skus_total               integer,
  skus_processed           integer NOT NULL DEFAULT 0,
  failure_reason           text,
  started_at               timestamptz NOT NULL DEFAULT NOW(),
  completed_at             timestamptz,

  -- One scan job at a time per marketplace
  CONSTRAINT scan_job_unique_per_marketplace
    EXCLUDE USING btree (customer_marketplace_id WITH =)
    WHERE (status NOT IN ('COMPLETE', 'FAILED'))
);
-- RLS: customer reads own
```

## worker_heartbeats (Operations)
- AD23 liveness signal; no RLS (operational; service-role only); retention: keep last 24h via daily prune cron

```sql
CREATE TABLE worker_heartbeats (
  id                  bigserial PRIMARY KEY,
  worker_instance_id  text NOT NULL,                       -- e.g., Coolify container hostname
  written_at          timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_worker_heartbeats_written_at
  ON worker_heartbeats(written_at DESC);
```

## pri01_staging (Operations)
- Per-cycle staging table per AD7/AD8; engine writes; writer consumes; archived to `audit_log` as `pri01-submit` events then truncated

```sql
CREATE TABLE pri01_staging (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_marketplace_id  uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  sku_id                   uuid NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  channel_code             text NOT NULL,
  new_price_cents          integer NOT NULL,
  cycle_id                 uuid NOT NULL,
  staged_at                timestamptz NOT NULL DEFAULT NOW(),
  flushed_at               timestamptz,                    -- set when PRI01 submitted
  import_id                text                            -- set when PRI01 returned import_id
);
CREATE INDEX idx_pri01_staging_cycle ON pri01_staging(cycle_id);
CREATE INDEX idx_pri01_staging_sku_unflushed
  ON pri01_staging(sku_id) WHERE flushed_at IS NULL;
-- RLS: customer reads own (via customer_marketplace_id)
```

## moloni_invoices (Billing)
- AD22; retained even after account deletion (fiscal record per AD21); `customer_id` FK has NO `ON DELETE` clause (default RESTRICT — fiscal retention)

```sql
CREATE TABLE moloni_invoices (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id                 uuid NOT NULL REFERENCES customers(id),
  customer_marketplace_id     uuid REFERENCES customer_marketplaces(id),  -- null if multi-marketplace invoice
  moloni_invoice_id           text NOT NULL,                              -- Moloni-side identifier
  stripe_payment_intent_id    text NOT NULL,                              -- links to Stripe payment
  amount_cents                integer NOT NULL,
  nif                         text NOT NULL,                              -- captured at invoice generation
  issued_at                   timestamptz NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (moloni_invoice_id)
);
CREATE INDEX idx_moloni_invoices_customer ON moloni_invoices(customer_id, issued_at DESC);
-- RLS: customer reads own; founder admin read-write
```

## FK ON DELETE Summary (load-bearing for deletion-grace flow)
- `customers.id` → `auth.users(id)` ON DELETE CASCADE
- `customer_profiles.customer_id` → `customers(id)` ON DELETE CASCADE
- `customer_marketplaces.customer_id` → `customers(id)` ON DELETE CASCADE
- `shop_api_key_vault.customer_marketplace_id` → `customer_marketplaces(id)` ON DELETE CASCADE
- `skus.customer_marketplace_id` → `customer_marketplaces(id)` ON DELETE CASCADE
- `sku_channels.sku_id` → `skus(id)` ON DELETE CASCADE; `sku_channels.customer_marketplace_id` → `customer_marketplaces(id)` ON DELETE CASCADE
- `baseline_snapshots.sku_channel_id` → `sku_channels(id)` ON DELETE CASCADE; `baseline_snapshots.customer_marketplace_id` → `customer_marketplaces(id)` ON DELETE CASCADE
- `audit_log`: NO FK on `customer_marketplace_id`, `sku_id`, `sku_channel_id` (immutability per NFR-S6); `event_type` has FK to `audit_log_event_types(event_type)`
- `daily_kpi_snapshots.customer_marketplace_id` → `customer_marketplaces(id)` ON DELETE CASCADE
- `cycle_summaries.customer_marketplace_id` → `customer_marketplaces(id)` ON DELETE CASCADE
- `scan_jobs.customer_marketplace_id` → `customer_marketplaces(id)` ON DELETE CASCADE
- `pri01_staging.customer_marketplace_id` → `customer_marketplaces(id)` ON DELETE CASCADE; `pri01_staging.sku_id` → `skus(id)` ON DELETE CASCADE
- `moloni_invoices.customer_id` → `customers(id)` (default RESTRICT — fiscal retention); `moloni_invoices.customer_marketplace_id` → `customer_marketplaces(id)` (default RESTRICT)

## RLS Policy Summary
- Every customer-scoped table carries two policies: `<table>_select_own` — `USING (customer_id = auth.uid())` for direct-FK tables; `USING (customer_marketplace_id IN (SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()))` for marketplace-linked tables; `<table>_modify_own` — `WITH CHECK (...)` matching SELECT predicate, applied to INSERT/UPDATE/DELETE where customer-write allowed
- Read-only for customer (only SELECT policy; INSERT/UPDATE/DELETE service-role-only): `audit_log`, `cycle_summaries`, `daily_kpi_snapshots`, `worker_heartbeats`
- Service-role bypass: worker process and `/admin/*` routes (server-side only) connect with `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS); contract: worker MUST `.eq('customer_marketplace_id', ...)` per Step 5; `/admin/*` uses service-role only for read; never writes to customer-scoped tables outside documented admin actions (none at MVP)

## Schema Reservations for Epic 2 (no migration later)

| Reserved column | Table | Default | Epic 2 use |
|---|---|---|---|
| `cost_cents` | `skus` | NULL | Cost-CSV upload |
| `excluded_at` | `skus` | NULL | Per-SKU exclude / "promo mode" |
| `anomaly_threshold_pct` | `customer_marketplaces` | NULL → code uses 0.40 | Customer-tunable threshold |
| `tier_cadence_minutes_override` | `customer_marketplaces` | NULL | Per-customer cadence customization |
| `edge_step_cents` | `customer_marketplaces` | 1 | Customer-config undercut step |
| `master_key_version` | `shop_api_key_vault` | 1 | Master-key rotation ceremony (AD3) |

- Bonus (post-F10): `customer_marketplaces.sustained_transient_cycle_threshold` flagged for Epic 2 (no MVP column)
