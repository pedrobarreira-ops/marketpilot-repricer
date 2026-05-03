-- Story 1.4 / Atomicity Bundle A (F3 + AD29) — customer_profiles + trigger
--
-- This file is the load-bearing half of Bundle A:
--   - customer_profiles table (B2B fields needed for Moloni invoicing later)
--   - handle_new_auth_user() trigger function (SECURITY DEFINER, validates
--     required fields and writes BOTH customers + customer_profiles in the
--     same transaction as the auth.users INSERT — atomicity invariant)
--   - trg_handle_new_auth_user (AFTER INSERT FOR EACH ROW on auth.users)
--
-- Atomicity contract (AD29 + F3):
--   When supabase.auth.signUp(...) is called, GoTrue runs INSERT INTO
--   auth.users inside a transaction. trg_handle_new_auth_user fires in the
--   SAME transaction. RAISE EXCEPTION inside the trigger function rolls back
--   the entire transaction — including the auth.users row that fired the
--   trigger. There is no in-between state representable in the schema:
--   either all three rows commit (auth.users + customers + customer_profiles)
--   or zero rows commit. Application code does NOT need partial-state cleanup.
--
-- HINT-sentinel contract (consumed by app/src/lib/signup-error-mapper.js):
--   The HINT codes PROFILE_FIRST_NAME_REQUIRED / PROFILE_LAST_NAME_REQUIRED /
--   PROFILE_COMPANY_NAME_REQUIRED are part of the contract with the route-
--   side error mapper. Renaming them silently breaks PT-localized field
--   error rendering on signup. Do NOT change without a coordinated update.
--
-- SECURITY DEFINER + SET search_path = public:
--   SECURITY DEFINER is required so the function (running as the migration
--   owner / Supabase superuser) can write to public.customers and
--   public.customer_profiles from a transaction kicked off by GoTrue's
--   INSERT into auth.users. SET search_path = public hardens against
--   search-path-based privilege-escalation attacks (well-documented Postgres
--   SECURITY DEFINER hazard).
--
-- nif column is deliberately nullable:
--   AD22 — captured at first Moloni invoice generation, not at signup.
--   Do NOT make NOT NULL.
--
-- IMPORTANT: this file is append-only once committed. Schema changes after
-- the first commit ALWAYS create a new migration. Never edit this file
-- post-commit.
--
-- APPLY ORDER: depends on customers (202604301200_create_customers.sql).
-- MUST sort lexicographically AFTER that migration so the FK in
-- customer_profiles.customer_id resolves at apply time on a fresh DB.

CREATE TABLE customer_profiles (
  customer_id   uuid PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  first_name    text NOT NULL,                       -- AD29 — required at signup
  last_name     text NOT NULL,                       -- AD29 — required at signup
  company_name  text NOT NULL,                       -- AD29 — required at signup (B2B)
  nif           text,                                 -- AD22 — captured at first Moloni invoice (NULLABLE)
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_profiles_select_own ON customer_profiles
  FOR SELECT
  USING (customer_id = auth.uid());

-- UPDATE policy reserved for Phase-2 self-edit (AD22). Harmless without a
-- Phase-1 UI consumer; ships at MVP so the policy is in place when Story X
-- adds the /profile/edit surface.
CREATE POLICY customer_profiles_update_own ON customer_profiles
  FOR UPDATE
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

-- INSERT/DELETE: NO customer-side policy. INSERT lands via the trigger;
-- DELETE cascades from customers (which itself cascades from auth.users).

CREATE OR REPLACE FUNCTION public.handle_new_auth_user ()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_name   text;
  v_last_name    text;
  v_company_name text;
  v_source       text;
  v_campaign     text;
BEGIN
  v_first_name   := NEW.raw_user_meta_data ->> 'first_name';
  v_last_name    := NEW.raw_user_meta_data ->> 'last_name';
  v_company_name := NEW.raw_user_meta_data ->> 'company_name';
  v_source       := NEW.raw_user_meta_data ->> 'source';
  v_campaign     := NEW.raw_user_meta_data ->> 'campaign';

  IF v_first_name IS NULL OR length(trim(v_first_name)) = 0 THEN
    RAISE EXCEPTION 'first_name is required'
      USING ERRCODE = '23502', HINT = 'PROFILE_FIRST_NAME_REQUIRED';
  END IF;

  IF v_last_name IS NULL OR length(trim(v_last_name)) = 0 THEN
    RAISE EXCEPTION 'last_name is required'
      USING ERRCODE = '23502', HINT = 'PROFILE_LAST_NAME_REQUIRED';
  END IF;

  IF v_company_name IS NULL OR length(trim(v_company_name)) = 0 THEN
    RAISE EXCEPTION 'company_name is required'
      USING ERRCODE = '23502', HINT = 'PROFILE_COMPANY_NAME_REQUIRED';
  END IF;

  INSERT INTO public.customers (id, email, source, campaign)
  VALUES (NEW.id, NEW.email, v_source, v_campaign);

  INSERT INTO public.customer_profiles (customer_id, first_name, last_name, company_name)
  VALUES (NEW.id, trim(v_first_name), trim(v_last_name), trim(v_company_name));

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_handle_new_auth_user
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

-- TODO Story 2.2: add 'customer_profiles' to scripts/rls-regression-suite.js coverage list.
-- The suite must assert customer A cannot SELECT customer B's profile row.
