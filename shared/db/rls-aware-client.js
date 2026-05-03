// shared/db/rls-aware-client.js
//
// SSoT module for per-request RLS-armed Postgres clients.
// Uses the service-role pool as the connection source, then overrides the
// Postgres role and JWT claims so auth.uid() returns the correct user — making
// RLS policies fire for the authenticated customer.
//
// NEVER imports or exposes the service-role key or DATABASE_URL directly.
// The service-role connection is used solely to arm the JWT claim; the
// app-layer caller sees only the RLS-scoped PoolClient.
//
// Library Empirical Contract (Story 2.1 verified):
//   - auth.uid() reads COALESCE(request.jwt.claim.sub, request.jwt.claims::jsonb->>'sub')
//   - set_config with is_local=true only works inside an active transaction;
//     outside a transaction (autocommit), the setting is immediately discarded.
//   - Correct approach: decode the JWT payload and pass the JSON claims with
//     is_local=false (session-level), which persists for the connection lifecycle.
//   - The rls-context.js releaseRlsClient hook resets the settings on connection
//     release to prevent cross-request claim leakage when connections are pooled.

import { getServiceRoleClient } from './service-role-client.js';

/**
 * Decode the payload from a JWT (base64url middle segment) without verification.
 * Verification was already done upstream by Supabase auth.getUser() in auth.js.
 *
 * Uses Node's native `'base64url'` encoding (16+) which handles URL-safe
 * characters AND missing trailing padding canonically — JWTs are emitted with
 * stripped `=` padding, and the manual `+/` swap pattern silently relies on
 * Node's base64 decoder being lenient about padding (works today, but fragile
 * across platforms). `'base64url'` is the documented contract.
 *
 * Validates the payload is a plain JSON object containing a non-empty `sub`
 * claim. Without these checks, a malformed JWT body of `null`, an array, or a
 * primitive would silently round-trip through JSON.stringify and end up as the
 * `request.jwt.claims` GUC value — at which point `auth.uid()` resolves to
 * NULL and RLS policies relying on it (`USING (id = auth.uid())`) silently
 * filter to zero rows or, worse, expose `IS NULL` clauses unexpectedly.
 * Failing fast here is the safer default.
 *
 * @param {string} jwt - raw JWT string (header.payload.signature)
 * @returns {object} decoded JWT payload object with a `sub` claim
 */
function decodeJwtPayload (jwt) {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('getRlsAwareClient: invalid JWT format');
  const decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw new Error('getRlsAwareClient: JWT payload is not a JSON object');
  }
  if (typeof decoded.sub !== 'string' || decoded.sub.length === 0) {
    throw new Error('getRlsAwareClient: JWT payload missing required "sub" claim');
  }
  return decoded;
}

/**
 * Reset the RLS session settings on a connection to prevent claim leakage
 * when the connection is returned to the pool.
 *
 * Returns the reset error (or null on success) so the caller can decide
 * whether to release the connection cleanly or with an error flag. Silently
 * swallowing reset failures would leave a connection with stale
 * `request.jwt.claims` in the pool — the exact cross-request leakage the
 * wrapper exists to prevent (statement_timeout / idle_in_transaction abort
 * paths can break the RESET round-trip without breaking the underlying
 * socket, so the pool would happily reuse the poisoned connection).
 *
 * @param {import('pg').PoolClient} client - pg PoolClient to reset
 * @returns {Promise<Error|null>} the reset error if RESET failed; null on success
 */
async function resetRlsSettings (client) {
  try {
    await client.query(`RESET ROLE`);
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
    return null;
  } catch (err) {
    return err;
  }
}

/**
 * Returns a pg PoolClient with RLS armed for the given JWT subject.
 *
 * Pattern: check out a client from the service-role pool, decode the JWT
 * payload, and issue set_config('request.jwt.claims', <json>, false) so
 * auth.uid() resolves to the JWT sub claim for all subsequent queries on
 * this connection. Uses session-level (is_local=false) because the setting
 * must survive multiple query() calls on the same client without an explicit
 * transaction wrapper. rls-context.js releaseRlsClient resets the settings
 * on release to prevent cross-request leakage.
 *
 * The caller MUST call client.release() after the request lifecycle.
 * Use via rls-context.js middleware which handles lifecycle automatically.
 *
 * Negative constraint: this module MUST NOT be imported in worker/src/ —
 * the worker operates as service_role only (no per-user JWT context).
 * Enforced by: integration test negative_assertion_rls_aware_client_not_importable_in_worker.
 *
 * @param {string} jwt - Supabase Auth access_token (raw JWT string)
 * @returns {Promise<import('pg').PoolClient>} pg PoolClient with RLS armed
 */
export async function getRlsAwareClient (jwt) {
  const pool = getServiceRoleClient();
  const client = await pool.connect();
  try {
    // Decode JWT payload to extract claims as JSON.
    // auth.uid() in Supabase local reads: request.jwt.claims::jsonb ->> 'sub'
    // We must pass the decoded claims JSON (not the raw JWT string).
    const claimsJson = JSON.stringify(decodeJwtPayload(jwt));

    // Use is_local=false (session-level) so the setting persists across multiple
    // query() calls on the same connection without wrapping everything in BEGIN/COMMIT.
    // We wrap the client's release() method to auto-reset settings before returning
    // the connection to the pool — preventing cross-request JWT claim leakage.
    //
    // NOTE: only set request.jwt.claims here — the role is established below via
    // `SET ROLE authenticated` (the canonical Postgres command). A duplicate
    // `set_config('role', 'authenticated', false)` was previously issued
    // alongside the claims; it was redundant since `SET ROLE` writes the same
    // GUC, and dropping it shaves one extra round-trip per request.
    await client.query(
      `SELECT set_config('request.jwt.claims', $1, false)`,
      [claimsJson]
    );
    // Switch the connection's effective Postgres role so RLS policies targeting
    // the 'authenticated' role fire correctly.
    await client.query(`SET ROLE authenticated`);
  } catch (err) {
    // Release with error flag so pg marks this client as unusable and removes
    // it from the pool rather than returning a poisoned connection.
    client.release(err);
    throw err;
  }

  // Wrap release() to auto-reset RLS session settings before returning to pool.
  // This prevents cross-request claim leakage when connections are reused.
  // If the RESET round-trip itself fails, force release with an error flag so
  // the pool discards the connection rather than handing it to the next caller
  // with stale request.jwt.claims still set.
  //
  // Double-release guard: pg's PoolClient.release is idempotent (a second call
  // is a no-op once the underlying client is back in the pool), but the wrapped
  // version awaits SQL queries first — calling it twice would issue RESET
  // queries on a connection no longer owned by us, potentially racing the next
  // caller's session settings. Track release state so a duplicate call resolves
  // immediately without touching the connection.
  const originalRelease = client.release.bind(client);
  let released = false;
  client.release = async (err) => {
    if (released) return;
    released = true;
    const resetErr = await resetRlsSettings(client);
    return originalRelease(err ?? resetErr ?? undefined);
  };

  return client;
}
