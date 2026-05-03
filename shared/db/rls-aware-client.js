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
 * @param {string} jwt - raw JWT string (header.payload.signature)
 * @returns {object} decoded JWT payload object
 */
function decodeJwtPayload (jwt) {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('getRlsAwareClient: invalid JWT format');
  // base64url → base64 → Buffer → JSON
  const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
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
/**
 * Reset the RLS session settings on a connection to prevent claim leakage
 * when the connection is returned to the pool.
 *
 * @param {import('pg').PoolClient} client - pg PoolClient to reset
 * @returns {Promise<void>}
 */
async function resetRlsSettings (client) {
  try {
    await client.query(`RESET ROLE`);
    await client.query(`SELECT set_config('request.jwt.claims', '', false)`);
  } catch {
    // Ignore reset errors — if the connection is broken, the pool will discard it.
  }
}

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
    await client.query(
      `SELECT set_config('request.jwt.claims', $1, false), set_config('role', 'authenticated', false)`,
      [claimsJson]
    );
    // Belt-and-suspenders: explicitly set the role so RLS policies targeting
    // the 'authenticated' Postgres role fire correctly.
    await client.query(`SET ROLE authenticated`);
  } catch (err) {
    // Release with error flag so pg marks this client as unusable and removes
    // it from the pool rather than returning a poisoned connection.
    client.release(err);
    throw err;
  }

  // Wrap release() to auto-reset RLS session settings before returning to pool.
  // This prevents cross-request claim leakage when connections are reused.
  const originalRelease = client.release.bind(client);
  client.release = async (err) => {
    await resetRlsSettings(client);
    return originalRelease(err);
  };

  return client;
}
