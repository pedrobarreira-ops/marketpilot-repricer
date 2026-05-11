-- Story 6.3 Step-7 follow-up: extend the dispatcher hot-path partial index to
-- include the new frozen_for_pri01_persistent predicate.
--
-- Background:
--   The base index `idx_sku_channels_dispatch` (202604301206_create_sku_channels.sql)
--   filters on:  pending_import_id IS NULL AND frozen_for_anomaly_review = false
--
--   Story 6.3 added a new dispatcher predicate (`frozen_for_pri01_persistent = false`)
--   in worker/src/dispatcher.js, but the partial-index WHERE clause was not
--   updated in the same migration. Without this update, frozen-PRI01 rows still
--   live inside the index and degrade the dispatcher SELECT's selectivity over
--   time as the freeze-flag accumulates trues.
--
-- Approach:
--   DROP + CREATE the partial index with the additional predicate.
--   This is a metadata-only operation on a small index; no table rewrite.
--
-- Postgres rejects a WHERE-clause change via ALTER INDEX, so DROP+CREATE is the
-- only path. CONCURRENTLY would avoid a brief AccessExclusiveLock, but Supabase
-- migrations run inside a transaction and CONCURRENTLY is not transaction-safe.
-- The lock window is sub-second on a small partial index — acceptable.

DROP INDEX IF EXISTS idx_sku_channels_dispatch;

CREATE INDEX idx_sku_channels_dispatch
  ON sku_channels(customer_marketplace_id, last_checked_at, tier_cadence_minutes)
  WHERE pending_import_id IS NULL
    AND frozen_for_anomaly_review = false
    AND frozen_for_pri01_persistent = false;
