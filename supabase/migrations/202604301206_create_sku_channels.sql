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
