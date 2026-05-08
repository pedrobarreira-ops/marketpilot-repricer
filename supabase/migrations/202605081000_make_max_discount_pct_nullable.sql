-- supabase/migrations/202605081000_make_max_discount_pct_nullable.sql
--
-- Epic 4 retro Q1 (P0): Sentinel fix for Story 4.8 forward-only guard.
--
-- Problem: Story 4.3's key.js INSERTs max_discount_pct = 0.0300 as a placeholder
-- at PROVISIONING time, and the column was declared NOT NULL. Story 4.8's
-- forward-only guard checks `IS NOT NULL` to detect "user has chosen a margin",
-- but with a NOT NULL column + always-set placeholder, the sentinel is
-- unreachable — every DRY_RUN customer gets redirected to / before they can
-- answer the margin question. Worse, the placeholder 0.0300 is identical to
-- the 15_plus band mapping, so by-value disambiguation is impossible.
--
-- Fix: drop NOT NULL on max_discount_pct so the column expresses the spec's
-- intended semantic ("user has explicitly chosen a margin band"). Story 4.3's
-- key.js will be updated in the same PR to drop the placeholder INSERT.
--
-- Depends on: 202604301203_create_customer_marketplaces.sql

ALTER TABLE customer_marketplaces
  ALTER COLUMN max_discount_pct DROP NOT NULL;
