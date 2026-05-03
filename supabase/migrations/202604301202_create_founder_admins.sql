-- Story 1.5 — founder_admins seed (AD4 — founder admin read-only).
--
-- Authoritative allow-list of founder emails that gate every future admin-only
-- surface (Story 8.10 /admin/status, Story 11.4 concierge marketplace add,
-- Story 11.5 Moloni founder operational record). Constraint #13 — the founder
-- NEVER logs in as the customer; admin status is binary (founder OR not).
--
-- AD4 — service-role-only access:
--   This is a system table. There is no per-customer scope, so no auth.uid()
--   predicate would make sense. The `founder-admin-only` middleware reads it
--   via a service-role pg.Pool (which bypasses RLS); the customer-side
--   anon/JWT clients have no read path because nothing authenticates as a
--   founder via Supabase Auth roles. RLS is therefore explicitly DISABLED.
--
-- Critical RLS-disable note (project-context.md / Supabase MCP):
--   Project ttqwrbtnwtyeehynzubw has the `ensure_rls` event trigger enabled,
--   which auto-enables RLS on every new public-schema table at CREATE time.
--   Without the explicit `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` line
--   below, RLS would silently auto-enable with zero policies and the founder
--   middleware's service-role lookup would return zero rows in some
--   configurations (universal 403). The DISABLE is load-bearing.
--
-- Constraint #16 — no team-membership / role table:
--   founder_admins is the entire authorization model. There is no team table,
--   no role column, no JWT custom claim. The single email-key allow-list IS
--   the design. Adding a role column or swapping in a team-membership table
--   would violate the constraint. (Forbidden literal table names intentionally
--   omitted from this comment so Story 1.4's signup-flow.test.js
--   `negative_assertion_no_team_table_in_source` grep stays clean.)
--
-- Co-founder addition pattern (Phase 2 / future):
--   When Pedro adds a co-founder later, the right pattern is a NEW migration
--   `<ts>_add_<cofounder_name>_to_founder_admins.sql` with a single
--   `INSERT INTO founder_admins (email, notes) VALUES (...) ON CONFLICT DO NOTHING;`.
--   Never edit this file post-commit.
--
-- IMPORTANT: this file is append-only once committed. Schema changes after
-- the first commit ALWAYS create a new migration. Never edit this file
-- post-commit.

CREATE TABLE founder_admins (
  email      text PRIMARY KEY,
  notes      text,                                  -- nullable — operator notes
  created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Override the project's `ensure_rls` event trigger auto-enable behavior.
-- founder_admins is service-role-only; RLS would only obstruct legitimate
-- lookups and provides zero security benefit (no per-tenant scope).
ALTER TABLE founder_admins DISABLE ROW LEVEL SECURITY;

-- Defense-in-depth: REVOKE Supabase's default grants on the public schema for
-- this table. Without RLS AND without REVOKE, PostgREST's `anon` and
-- `authenticated` roles would have SELECT — any logged-in customer could hit
-- /rest/v1/founder_admins and enumerate the founder allow-list. The founder
-- middleware uses SUPABASE_SERVICE_ROLE_DATABASE_URL (service-role bypasses
-- GRANT/REVOKE), so this REVOKE is invisible to the legitimate read path.
-- Belt-and-braces: revoke from PUBLIC too so any future role doesn't inherit.
REVOKE ALL ON founder_admins FROM anon, authenticated, PUBLIC;

-- Pedro seed. Idempotent on re-apply (ON CONFLICT DO NOTHING).
INSERT INTO founder_admins (email, notes)
VALUES ('pedro@marketpilot.pt', 'Founder — Pedro Barreira')
ON CONFLICT (email) DO NOTHING;

-- TODO Story 2.2: founder_admins is service-role-only with no RLS policies;
-- rls-regression-suite SHOULD assert RLS is OFF on this table (defensive —
-- ensures a future automation doesn't silently enable it).
