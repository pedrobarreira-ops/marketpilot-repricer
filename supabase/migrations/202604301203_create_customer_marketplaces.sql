-- supabase/migrations/202604301203_create_customer_marketplaces.sql
--
-- Story 4.1: customer_marketplaces schema with F4 PROVISIONING state + cron_state machine.
--
-- Creates:
--   - cron_state enum (8 UPPER_SNAKE_CASE values, F13 amendment)
--   - channel_pricing_mode enum (3 values)
--   - csv_delimiter enum (2 values)
--   - marketplace_operator enum (1 MVP value: WORTEN)
--   - customer_marketplaces table (full DDL per AC#1, AD6, AD10, AD15, AD16, AD26)
--   - F4 CHECK constraint (customer_marketplace_provisioning_completeness)
--   - 3 indexes (customer_id, cron_state_active partial, last_pc01_pulled_at)
--   - UNIQUE (customer_id, operator, shop_id)
--   - RLS policies (same migration — Step 5 atomicity pattern, AD30)
--
-- Depends on: 202604301200_create_customers.sql (customers table + customers.id FK target)

-- ---------------------------------------------------------------------------
-- Enums (created BEFORE the table)
-- ---------------------------------------------------------------------------

CREATE TYPE cron_state AS ENUM (
  'PROVISIONING',
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

-- marketplace_operator: starts with WORTEN only at MVP; extends in future epics.
CREATE TYPE marketplace_operator AS ENUM ('WORTEN');

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE customer_marketplaces (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id                     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  operator                        marketplace_operator NOT NULL,
  marketplace_instance_url        text NOT NULL,

  -- A01 capture (AD16 step 2). F4: NULLABLE while cron_state = 'PROVISIONING'.
  shop_id                         bigint,
  shop_name                       text,
  shop_state                      text,
  currency_iso_code               text,
  is_professional                 boolean,
  channels                        text[],

  -- PC01 capture (AD16 step 3, AD26 monthly re-pull). F4: NULLABLE while PROVISIONING.
  channel_pricing_mode            channel_pricing_mode,
  operator_csv_delimiter          csv_delimiter,
  offer_prices_decimals           smallint,
  discount_period_required        boolean,
  competitive_pricing_tool        boolean,
  scheduled_pricing               boolean,
  volume_pricing                  boolean,
  multi_currency                  boolean,
  order_tax_mode                  text,
  platform_features_snapshot      jsonb,
  last_pc01_pulled_at             timestamptz,

  -- Engine config (per-marketplace). Phase 2 reservations: anomaly_threshold_pct, tier_cadence_minutes_override, edge_step_cents.
  -- max_discount_pct has NO DEFAULT: Story 4.3 sets it from the margin form; Story 4.8 writes it.
  -- INSERT will fail if not provided — this is intentional.
  max_discount_pct                numeric(5,4) NOT NULL,
  max_increase_pct                numeric(5,4) NOT NULL DEFAULT 0.0500,
  edge_step_cents                 integer NOT NULL DEFAULT 1,
  anomaly_threshold_pct           numeric(5,4),
  tier_cadence_minutes_override   jsonb,

  -- State machine (F4, F13 UPPER_SNAKE_CASE)
  cron_state                      cron_state NOT NULL DEFAULT 'PROVISIONING',
  cron_state_changed_at           timestamptz NOT NULL DEFAULT NOW(),

  -- Stripe linkage (F2 corrected): per-marketplace SubscriptionItem only.
  -- NULL until first Go-Live.
  stripe_subscription_item_id     text UNIQUE,

  created_at                      timestamptz NOT NULL DEFAULT NOW(),
  updated_at                      timestamptz NOT NULL DEFAULT NOW(),

  -- Prevent accidental duplicate marketplace add for the same customer+operator+shop.
  UNIQUE (customer_id, operator, shop_id),

  -- F4: leaving PROVISIONING requires all A01/PC01 captures populated.
  -- Any non-PROVISIONING state (DRY_RUN, ACTIVE, PAUSED_*) requires all
  -- A01 and PC01 columns to be non-NULL. This ensures the repricing engine
  -- never operates with incomplete marketplace configuration data.
  CONSTRAINT customer_marketplace_provisioning_completeness
    CHECK (
      cron_state = 'PROVISIONING'
      OR (
        shop_id IS NOT NULL AND shop_name IS NOT NULL AND shop_state IS NOT NULL
        AND currency_iso_code IS NOT NULL AND is_professional IS NOT NULL AND channels IS NOT NULL
        AND channel_pricing_mode IS NOT NULL AND operator_csv_delimiter IS NOT NULL
        AND offer_prices_decimals IS NOT NULL AND discount_period_required IS NOT NULL
        AND competitive_pricing_tool IS NOT NULL AND scheduled_pricing IS NOT NULL
        AND volume_pricing IS NOT NULL AND multi_currency IS NOT NULL
        AND order_tax_mode IS NOT NULL AND platform_features_snapshot IS NOT NULL
        AND last_pc01_pulled_at IS NOT NULL
      )
    )
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Basic FK index (any join on customer_id)
CREATE INDEX idx_customer_marketplaces_customer_id
  ON customer_marketplaces(customer_id);

-- Partial index: repricer engine only cares about ACTIVE marketplaces (Story 5.1, 7.x).
-- Keeps the index small — only a fraction of rows will be ACTIVE at any time.
CREATE INDEX idx_customer_marketplaces_cron_state_active
  ON customer_marketplaces(id) WHERE cron_state = 'ACTIVE';

-- For the monthly PC01 re-pull cron (AD26): find marketplaces whose PC01 snapshot
-- is stale (last_pc01_pulled_at < NOW() - interval '30 days').
CREATE INDEX idx_customer_marketplaces_last_pc01_pulled_at
  ON customer_marketplaces(last_pc01_pulled_at);

-- ---------------------------------------------------------------------------
-- RLS (same migration — Step 5 atomicity pattern)
-- ---------------------------------------------------------------------------

ALTER TABLE customer_marketplaces ENABLE ROW LEVEL SECURITY;

-- Customers can only SELECT their own marketplace rows.
CREATE POLICY customer_marketplaces_select_own ON customer_marketplaces
  FOR SELECT USING (customer_id = auth.uid());

-- Customers can INSERT, UPDATE, DELETE only their own marketplace rows.
-- WITH CHECK enforces that newly inserted/updated rows also belong to auth.uid().
CREATE POLICY customer_marketplaces_modify_own ON customer_marketplaces
  FOR ALL USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());
