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
