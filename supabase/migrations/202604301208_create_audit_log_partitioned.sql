-- Story 9.1: audit_log partitioned base table + priority-derivation trigger +
-- 12 initial monthly partitions (2026-05 through 2027-04) + compound indexes + RLS.
--
-- Dependencies:
--   Must run after 20260430120730_create_audit_log_event_types.sql (F5 amendment).
--   Lexicographic order: '20260430120730' < '202604301208' (position 11: '7' < '8').
--
-- F8 amendment: sku_id and sku_channel_id carry NO FK constraints — preserves audit
-- history if a SKU or sku_channel is later removed (audit log is immutable, NFR-S6).

-- ---------------------------------------------------------------------------
-- 1. Base partitioned table
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_marketplace_id  uuid NOT NULL,
  -- F8: sku_id intentionally carries NO FK constraint — preserves audit history if a
  -- SKU is later removed from catalog (e.g., seller delists). Audit log is immutable
  -- per NFR-S6; referential integrity to ephemeral catalog rows would compromise that.
  sku_id                   uuid,
  -- F8: sku_channel_id intentionally carries NO FK constraint — same rationale as
  -- sku_id above. Do NOT add a FK here "for cleanliness"; the omission is deliberate.
  sku_channel_id           uuid,
  cycle_id                 uuid,
  event_type               text NOT NULL REFERENCES audit_log_event_types(event_type),
  priority                 audit_log_priority NOT NULL,
  payload                  jsonb NOT NULL,
  resolved_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- ---------------------------------------------------------------------------
-- 2. Initial 12 monthly partitions (2026-05 through 2027-04)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log_2026_05 PARTITION OF audit_log FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE audit_log_2026_06 PARTITION OF audit_log FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE audit_log_2026_07 PARTITION OF audit_log FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit_log_2026_08 PARTITION OF audit_log FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE audit_log_2026_09 PARTITION OF audit_log FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE audit_log_2026_10 PARTITION OF audit_log FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE audit_log_2026_11 PARTITION OF audit_log FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_log_2026_12 PARTITION OF audit_log FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE audit_log_2027_01 PARTITION OF audit_log FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE audit_log_2027_02 PARTITION OF audit_log FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE audit_log_2027_03 PARTITION OF audit_log FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE audit_log_2027_04 PARTITION OF audit_log FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');

-- ---------------------------------------------------------------------------
-- 3. Compound indexes (AD19) — Postgres propagates to all partitions
-- ---------------------------------------------------------------------------

-- Primary query path: customer's events ordered by recency
CREATE INDEX idx_audit_log_customer_created
  ON audit_log(customer_marketplace_id, created_at DESC);

-- Search-by-SKU surface (Story 9.4): partial index on rows with a SKU
CREATE INDEX idx_audit_log_customer_sku_created
  ON audit_log(customer_marketplace_id, sku_id, created_at DESC)
  WHERE sku_id IS NOT NULL;

-- Feed filtering by event type (Story 9.3)
CREATE INDEX idx_audit_log_customer_eventtype_created
  ON audit_log(customer_marketplace_id, event_type, created_at DESC);

-- Firehose drill-down by cycle (Story 9.5): partial index on rows with a cycle
CREATE INDEX idx_audit_log_customer_cycle
  ON audit_log(customer_marketplace_id, cycle_id, sku_id)
  WHERE cycle_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Priority-derivation trigger function (AD20)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 5. Trigger registration — fires BEFORE INSERT on every row
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_audit_log_set_priority
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_set_priority();

-- ---------------------------------------------------------------------------
-- 6. RLS — customer read-only (own rows); INSERT/UPDATE/DELETE service-role only
-- ---------------------------------------------------------------------------

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Customer read-only: own rows via customer_marketplace_id chain.
-- auth.uid() IS NOT NULL guard prevents anon-role reads from accidentally
-- matching NULL = NULL in the subquery.
CREATE POLICY audit_log_select_own ON audit_log
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces
      WHERE customer_id = auth.uid()
    )
  );

-- INSERT / UPDATE / DELETE: denied for customers (service-role only).
-- No permissive policies for these operations = denied by default under RLS.
-- NFR-S6: audit log is append-only at the app layer. Only the worker (service-role)
-- may INSERT. No UPDATE or DELETE is ever legitimate at the app layer.
