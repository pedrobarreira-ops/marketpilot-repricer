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
