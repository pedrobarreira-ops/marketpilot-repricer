-- AD3 envelope-encryption vault: AES-256-GCM (12-byte nonce, 16-byte auth tag).
-- One row per customer_marketplaces row; ON DELETE CASCADE so vault row goes
-- when the marketplace row goes.
--
-- Encryption + decryption helpers live in shared/crypto/envelope.js.
-- Master key custody: Coolify env var MASTER_KEY_BASE64 (1Password cold backup);
-- master_key_version supports the AD3 annual rotation ceremony.
--
-- RLS: customer-scoped SELECT only (existence-read); no customer-side INSERT/UPDATE/DELETE.
-- Worker writes via service-role connection (bypasses RLS).
--
-- IMPORTANT: this file is append-only once committed. Schema changes after the
-- first commit ALWAYS create a new migration. Never edit this file post-commit.
-- (Project-context.md migration-immutability rule, captured 2026-05-01 after
-- Story 1.1's CR pass attempted to edit an applied migration to add an index.)
--
-- APPLY ORDER: depends on customer_marketplaces (Story 4.1, migration 202604301203).
-- Per Story 1.2 spec Option A, this file is committed but `npx supabase db push`
-- is deferred until Story 4.1's migration lands. Lexicographic order (1203 < 1204)
-- ensures correct apply sequence on a fresh DB once both files exist.

CREATE TABLE shop_api_key_vault (
  customer_marketplace_id  uuid PRIMARY KEY REFERENCES customer_marketplaces(id) ON DELETE CASCADE,
  ciphertext               bytea NOT NULL,
  nonce                    bytea NOT NULL,                 -- 12 bytes for AES-256-GCM
  auth_tag                 bytea NOT NULL,                 -- 16 bytes
  master_key_version       integer NOT NULL DEFAULT 1,     -- supports rotation ceremony (AD3)
  last_validated_at        timestamptz,                    -- last successful Mirakl call (set by worker)
  last_failure_status      smallint,                       -- last HTTP status if 401/403/etc.
  created_at               timestamptz NOT NULL DEFAULT NOW(),
  updated_at               timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE shop_api_key_vault ENABLE ROW LEVEL SECURITY;

-- Customer reads own vault row(s) by joining through customer_marketplaces.
-- Ciphertext/nonce/auth_tag are useless without the master key (held only in
-- worker process memory), so allowing SELECT-existence is acceptable.
CREATE POLICY shop_api_key_vault_select_own ON shop_api_key_vault
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND
    customer_marketplace_id IN (
      SELECT id FROM customer_marketplaces WHERE customer_id = auth.uid()
    )
  );
-- Story 2.2 deferred finding fix: added `auth.uid() IS NOT NULL AND` defensive clause.
-- Without this, anon callers (auth.uid() = NULL) get 0 rows by SQL NULL semantics,
-- but the intent is explicit rejection. The guard makes the policy self-documenting
-- and prevents future USING clause rewriting from accidentally exposing NULL rows.

-- INSERT/UPDATE/DELETE: NO customer-side policy. All writes go through the
-- worker process via service-role connection (RLS bypassed).

-- TODO Story 2.2: add 'shop_api_key_vault' to scripts/rls-regression-suite.js coverage list.
-- The suite must assert customer A cannot SELECT customer B's vault row.
