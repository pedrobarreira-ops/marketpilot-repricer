-- Story 5.2: pri01_staging table + indexes + RLS policy.
--
-- Atomicity Bundle C participant: this table is the writer's input contract.
-- Every row carries a cycle_id (from the dispatcher) and a customer_marketplace_id.
-- flushed_at and import_id are nullable — set by the PRI01 writer (Story 6.1).
--
-- Dependencies:
--   Must run after 202604301206_create_sku_channels.sql (sku_id FK target)
--   Must run after 202604301203_create_customer_marketplaces.sql (customer_marketplace_id FK target)

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE pri01_staging (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_marketplace_id  uuid NOT NULL REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  sku_id                   uuid NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  channel_code             text NOT NULL,
  new_price_cents          integer NOT NULL,
  cycle_id                 uuid NOT NULL,
  staged_at                timestamptz NOT NULL DEFAULT NOW(),
  flushed_at               timestamptz,           -- set when PRI01 submitted; nullable
  import_id                text                   -- set when PRI01 returns importId; nullable
);

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_pri01_staging_cycle ON pri01_staging(cycle_id);

CREATE INDEX idx_pri01_staging_sku_unflushed
  ON pri01_staging(sku_id) WHERE flushed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. RLS policy (chained-FK pattern — matches sku_channels, baseline_snapshots)
-- ---------------------------------------------------------------------------

ALTER TABLE pri01_staging ENABLE ROW LEVEL SECURITY;

CREATE POLICY pri01_staging_select_own ON pri01_staging
  FOR SELECT USING (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );

CREATE POLICY pri01_staging_modify_own ON pri01_staging
  FOR ALL WITH CHECK (
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );
