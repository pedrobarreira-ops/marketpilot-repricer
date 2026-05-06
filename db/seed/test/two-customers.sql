-- db/seed/test/two-customers.sql
--
-- Test seed file for the RLS regression suite (Story 2.2 / AC#1).
--
-- IMPORTANT: auth.users rows are NOT seeded here.
-- The handle_new_auth_user trigger fires on INSERT INTO auth.users and
-- automatically creates the public.customers + public.customer_profiles rows.
-- Auth users must be created via the Supabase JS admin API in the test JS code
-- (see tests/integration/rls-regression.test.js seedTwoCustomers()) to avoid
-- coupling against Supabase's internal auth.users schema layout.
--
-- This file seeds ONLY public.* tables that are not created by the trigger.
-- At Epic 2 baseline there are no such rows — the two customers and their
-- profiles are fully created by the trigger.
--
-- Convention note (Story 2.2 AC#4):
--   Every new customer-scoped table that needs a row in this file MUST also
--   have a corresponding entry in the CUSTOMER_SCOPED_TABLES registry in
--   tests/integration/rls-regression.test.js.
--   Failing to add to the registry causes the
--   convention_every_seed_table_is_in_regression_config test to fail with:
--   "table <name> present in seed but missing from CUSTOMER_SCOPED_TABLES registry"
--
-- ============================================================================
-- Epic 4 Story 4.1: customer_marketplaces rows for test customers.
--
-- IMPORTANT: customer_id values are substituted at test runtime by the JS admin API.
-- The seedHelper in CUSTOMER_SCOPED_TABLES (rls-regression.test.js) performs the
-- actual INSERT with the real customer UUID. This SQL block documents the shape and
-- satisfies the convention_every_seed_table_is_in_regression_config check which
-- scans this file for INSERT statements to verify registry membership.
--
-- Both test customers start in PROVISIONING with all A01/PC01 columns NULL.
-- This satisfies the F4 CHECK constraint (customer_marketplace_provisioning_completeness).
-- max_discount_pct is required (no DEFAULT per architecture constraint #8 — set at margin form).
-- ============================================================================

-- Story 4.1 (Epic 4): one customer_marketplaces row per test customer.
-- A01/PC01 columns all NULL (PROVISIONING state satisfies F4 CHECK constraint).
-- customer_id is provided by the test seedHelper at runtime (placeholder below is for
-- the convention test's INSERT detection only — not executed directly).
INSERT INTO customer_marketplaces (customer_id, operator, marketplace_instance_url, max_discount_pct)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'WORTEN', 'https://marketplace.worten.pt', 0.015),
  ('00000000-0000-0000-0000-000000000002', 'WORTEN', 'https://marketplace.worten.pt', 0.015)
ON CONFLICT DO NOTHING;

-- Story 4.1 (Epic 4): shop_api_key_vault rows become live once customer_marketplaces exists.
-- These rows are seeded at test runtime (after customer_marketplace rows are created with real UUIDs).
-- The INSERT below documents the shape for the convention test.
INSERT INTO shop_api_key_vault (customer_marketplace_id, ciphertext, nonce, auth_tag, master_key_version)
VALUES
  ('00000000-0000-0000-0000-100000000001', '\xdeadbeef', '\xdeadbeef', '\xdeadbeef', 1),
  ('00000000-0000-0000-0000-100000000002', '\xdeadbeef', '\xdeadbeef', '\xdeadbeef', 1)
ON CONFLICT DO NOTHING;

-- Idempotency: this file is NOT idempotent on its own.
-- Run resetAuthAndCustomers() before each test to clear auth.users (which
-- cascades to customers and customer_profiles), then re-seed via JS admin API.
-- The seedHelper in CUSTOMER_SCOPED_TABLES handles actual customer_marketplaces seeding.
