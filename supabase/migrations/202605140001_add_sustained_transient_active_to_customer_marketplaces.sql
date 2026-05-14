-- supabase/migrations/202605140001_add_sustained_transient_active_to_customer_marketplaces.sql
--
-- Story 8.1: Add sustained_transient_active column to customer_marketplaces.
--
-- This column is a placeholder for the sustained-transient classifier that
-- Story 12.1 ships (cycle-fail-sustained event type + worker classifier).
-- Story 8.1 renders the "sustained transient" grey informational banner when
-- this column is TRUE (≥3 consecutive cycle failures per FR39/§9.9).
--
-- Story 12.1 will set this column to TRUE when the threshold is breached.
-- Defaults to FALSE so existing rows behave as "no sustained transient".

ALTER TABLE customer_marketplaces
  ADD COLUMN IF NOT EXISTS sustained_transient_active BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN customer_marketplaces.sustained_transient_active IS
  'TRUE when ≥3 consecutive cycle failures have been recorded (FR39). '
  'Set by Story 12.1 worker classifier. Story 8.1 renders §9.9 grey informational banner.';
