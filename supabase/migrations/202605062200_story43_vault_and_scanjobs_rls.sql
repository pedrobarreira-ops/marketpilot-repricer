-- Story 4.3: Add customer-side INSERT + UPDATE RLS policies for shop_api_key_vault
-- and INSERT policy for scan_jobs.
--
-- Context: Story 4.3's /onboarding/key/validate route writes to shop_api_key_vault
-- and scan_jobs under the authenticated customer's RLS context (req.db, RLS-aware client).
-- The original shop_api_key_vault migration (202604301204) assumed worker-only writes,
-- but Story 4.3 adds the onboarding write path from the app layer. The scan_jobs
-- migration (202604301211, owned by Story 4.2) defines only `scan_jobs_select_own`;
-- this file adds the customer-side INSERT policy needed by the onboarding route so
-- 202604301211 stays byte-identical with Story 4.2's canonical version (no merge
-- conflict when 4.2 lands first).
--
-- Append-only: never edit 202604301204_create_shop_api_key_vault.sql or
-- 202604301211_create_scan_jobs.sql after they are applied. Add new policies here.

-- ── shop_api_key_vault: allow customer to INSERT their own vault row ────────────
-- The UPSERT in the onboarding route creates the initial encrypted key row.
-- ON CONFLICT DO UPDATE requires both INSERT and UPDATE to be permitted.
CREATE POLICY shop_api_key_vault_insert_own ON shop_api_key_vault
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );

-- shop_api_key_vault: allow customer to UPDATE their own vault row (key rotation)
CREATE POLICY shop_api_key_vault_update_own ON shop_api_key_vault
  FOR UPDATE USING (
    auth.uid() IS NOT NULL AND
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  ) WITH CHECK (
    auth.uid() IS NOT NULL AND
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );

-- ── scan_jobs: allow customer to INSERT their initial scan_jobs row ────────────
-- The onboarding route creates the initial PENDING row after a successful key
-- validation (Story 4.3). The worker drives subsequent status transitions via
-- service-role and bypasses RLS, so no UPDATE policy is added here.
-- This policy is owned by Story 4.3, not Story 4.2 — keeping it in this append-only
-- file avoids editing 202604301211_create_scan_jobs.sql (which is canonical to 4.2).
CREATE POLICY scan_jobs_insert_own ON scan_jobs
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );
