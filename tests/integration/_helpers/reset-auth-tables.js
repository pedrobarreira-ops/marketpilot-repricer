// Story 1.4 — service-role TRUNCATE helper for the signup-flow integration tests.
//
// auth.users is in the auth schema (Supabase-internal); a service-role-
// bypassing connection is required. The TRUNCATE CASCADE propagates through
// customers.id REFERENCES auth.users(id) ON DELETE CASCADE and
// customer_profiles.customer_id REFERENCES customers(id) ON DELETE CASCADE.
//
// SAFETY GUARD (Epic 1 retro Item 0, P0): this helper refuses to operate
// unless SUPABASE_SERVICE_ROLE_DATABASE_URL resolves to a local Postgres
// (connection string contains 'localhost' or '127.0.0.1'). A misconfigured
// CI run pointing at Supabase Cloud would otherwise wipe production
// auth.users rows via DELETE FROM auth.users. The guard runs at BOTH pool
// creation (so the helper can't connect to a non-local DB at all) AND
// before every DELETE call (defense in depth — covers the case where the
// env var is mutated mid-process and the pool is re-created).

import pg from 'pg';
const { Pool } = pg;

let _pool = null;
let _processCleanupRegistered = false;

function assertLocalConnection (connectionString) {
  if (!connectionString) {
    throw new Error(
      'reset-auth-tables.js: SUPABASE_SERVICE_ROLE_DATABASE_URL is not set. ' +
      'Integration tests require a local Postgres connection.'
    );
  }
  if (!connectionString.includes('localhost') && !connectionString.includes('127.0.0.1')) {
    // Redact password before throwing — connection strings are
    // postgres://user:password@host:port/db format
    const redacted = connectionString.replace(/:[^:@]*@/, ':***@');
    throw new Error(
      `reset-auth-tables.js SAFETY GUARD: refusing to operate on a non-local Postgres. ` +
      `SUPABASE_SERVICE_ROLE_DATABASE_URL must contain 'localhost' or '127.0.0.1'. ` +
      `Got: ${redacted}. ` +
      `If this is a CI run, fix the env var to point at the local Postgres test ` +
      `instance. NEVER point at Supabase Cloud — DELETE FROM auth.users would ` +
      `wipe production rows.`
    );
  }
}

function getPool () {
  if (_pool === null) {
    const connectionString = process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL;
    assertLocalConnection(connectionString);
    _pool = new Pool({
      connectionString,
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
  // Belt-and-suspenders: re-assert at the DELETE site, even though the pool
  // is already guarded at creation. Defends against env-var mutation
  // mid-process or future maintainers adding a non-DELETE call to the pool
  // that bypasses the guard, then later reusing the helper assuming the
  // guard still applies.
  assertLocalConnection(process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL);
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
