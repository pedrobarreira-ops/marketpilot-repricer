-- Story 1.4 / Atomicity Bundle A (F3 + AD29) — customers (Identity)
--
-- One row per auth.users row. The PK is also a FK to auth.users(id) so the
-- 1:1 invariant is enforced by the schema itself (Constraint #16: no
-- multi-user / team-membership table at MVP — single login per customer).
--
-- Source-context columns (FR7):
--   source, campaign — captured by app/src/middleware/source-context-capture.js
--   from ?source= / ?campaign= query params on _public routes; persisted into
--   raw_user_meta_data at signUp; written here by the
--   handle_new_auth_user() trigger (see 202604301201_*).
--
-- Deletion columns (AD21):
--   deletion_initiated_at / deletion_scheduled_at / day5_reminder_sent_at —
--   reserved for the 7-day-grace deletion flow; populated by the deletion
--   workflow (Story 10.x). Story 1.4 leaves them NULL.
--
-- Stripe linkage columns (F2):
--   stripe_customer_id / stripe_subscription_id — populated at billing
--   activation (Story 11.x). Story 1.4 leaves them NULL.
--
-- RLS:
--   ENABLED with customer-scoped SELECT (id = auth.uid()) ONLY.
--   No customer-side INSERT/UPDATE/DELETE policy — writes go through the
--   trigger via service-role only (signup) or the app via service-role
--   (deletion / Stripe linkage). The trigger function runs SECURITY DEFINER
--   in the migration owner's context (Supabase superuser), bypassing RLS.
--
-- IMPORTANT: this file is append-only once committed. Schema changes after
-- the first commit ALWAYS create a new migration. Never edit this file
-- post-commit. (project-context.md migration-immutability rule, captured
-- 2026-05-01 after Story 1.1's CR pass attempted to edit an applied
-- migration to add an index.)
--
-- APPLY ORDER: stand-alone (only depends on auth.users, which Supabase
-- always provides). MUST sort lexicographically BEFORE
-- 202604301201_create_customer_profiles_with_trigger.sql so the FK in that
-- migration resolves at apply time on a fresh DB.

CREATE TABLE customers (
  id                      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                   text NOT NULL,
  source                  text,                              -- FR7 funnel attribution (nullable)
  campaign                text,                              -- FR7 funnel attribution (nullable)
  deletion_initiated_at   timestamptz,                       -- AD21 7-day-grace deletion flow
  deletion_scheduled_at   timestamptz,                       -- AD21 7-day-grace deletion flow
  day5_reminder_sent_at   timestamptz,                       -- AD21 7-day-grace deletion flow
  stripe_customer_id      text UNIQUE,                       -- F2 Stripe linkage (set at billing activation)
  stripe_subscription_id  text UNIQUE,                       -- F2 Stripe linkage (set at billing activation)
  created_at              timestamptz NOT NULL DEFAULT NOW(),
  updated_at              timestamptz NOT NULL DEFAULT NOW()
);

-- Partial index supports the AD21 deletion-cron's daily scan over rows
-- with a scheduled deletion. WHERE-clause keeps the index tiny (only the
-- handful of customers in their 7-day grace window are indexed).
CREATE INDEX idx_customers_deletion_scheduled_at
  ON customers(deletion_scheduled_at)
  WHERE deletion_scheduled_at IS NOT NULL;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Customer reads own row only. The PK = auth.uid() check ensures cross-tenant
-- isolation. No SELECT policy on rows owned by other customers.
CREATE POLICY customers_select_own ON customers
  FOR SELECT
  USING (id = auth.uid());

-- INSERT/UPDATE/DELETE: NO customer-side policy. All writes go through:
--   - handle_new_auth_user() trigger (signup, SECURITY DEFINER)
--   - service-role connection (deletion, Stripe linkage, support ops)

-- TODO Story 2.2: add 'customers' to scripts/rls-regression-suite.js coverage list.
-- The suite must assert customer A cannot SELECT customer B's row.
