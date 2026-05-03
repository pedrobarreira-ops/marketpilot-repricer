// Story 1.4 — service-role TRUNCATE helper for the signup-flow integration tests.
//
// auth.users is in the auth schema (Supabase-internal); a service-role-
// bypassing connection is required. The TRUNCATE CASCADE propagates through
// customers.id REFERENCES auth.users(id) ON DELETE CASCADE and
// customer_profiles.customer_id REFERENCES customers(id) ON DELETE CASCADE.
//
// This helper runs only against a local test database — never against
// Supabase Cloud. The test runner is expected to point
// SUPABASE_SERVICE_ROLE_DATABASE_URL at the local Postgres in .env.test.

import pg from 'pg';
const { Pool } = pg;

let _pool = null;
let _processCleanupRegistered = false;

function getPool () {
  if (_pool === null) {
    _pool = new Pool({
      connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL,
      max: 2,
    });
    // P16: register a process-level cleanup once. Test runners that exit
    // before t.after fires (e.g., test setup throws synchronously, SIGINT
    // mid-run) would otherwise leak the pool's TCP connections — the next
    // CI run can hit "too many connections" against the local Postgres.
    if (!_processCleanupRegistered) {
      _processCleanupRegistered = true;
      const cleanup = () => {
        if (_pool !== null) {
          _pool.end().catch(() => {});
          _pool = null;
        }
      };
      process.on('beforeExit', cleanup);
      process.on('SIGINT', () => { cleanup(); process.exit(130); });
      process.on('SIGTERM', () => { cleanup(); process.exit(143); });
    }
  }
  return _pool;
}

export async function resetAuthAndCustomers () {
  const pool = getPool();
  // DELETE rather than TRUNCATE because TRUNCATE CASCADE requires sequence
  // ownership — and the auth schema's sequences (e.g. refresh_tokens_id_seq)
  // are owned by supabase_auth_admin, not the postgres connection user. The
  // ON DELETE CASCADE chains we and Supabase set up on auth.users children
  // (refresh_tokens, identities, sessions, etc.) propagate the DELETE
  // automatically, so a single DELETE FROM auth.users wipes all dependent
  // rows without needing TRUNCATE.
  await pool.query('DELETE FROM auth.users');
}

export async function endResetAuthPool () {
  if (_pool !== null) {
    await _pool.end();
    _pool = null;
  }
}

export function getResetAuthPool () {
  return getPool();
}
