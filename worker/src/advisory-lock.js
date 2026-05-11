// worker/src/advisory-lock.js
//
// SSoT module: Postgres advisory lock helpers for the per-customer dispatch guard.
// Story 5.1 / AC#3 — AD17 advisory-lock implementation.
//
// Advisory locks are SESSION-SCOPED in Postgres — they are automatically released
// when the DB session (client) closes. This eliminates any need for a manual
// lock-cleanup table (AD17 negative assertion: no row-based pseudo-mutex lock table
// anywhere in the codebase — use Postgres advisory locks only).
//
// Each customer_marketplace UUID is mapped deterministically to a Postgres bigint
// via `uuidToBigint` (first 8 bytes of UUID hex). The mapping is collision-resistant
// for small N (< 1000 customers) but not cryptographically unique — acceptable
// because the worst-case outcome of a collision is that two distinct customers share
// a lock key, causing one to skip a tick (not a data-corruption risk).

/**
 * Derive a deterministic Postgres advisory lock key (bigint) from a UUID string.
 * Uses the first 8 bytes of the UUID hex representation (strips hyphens, takes
 * first 16 hex characters, interprets the 64-bit pattern as a SIGNED bigint).
 *
 * Why signed (asIntN(64, ...)): Postgres `pg_try_advisory_lock(bigint)` accepts
 * `int8` whose range is signed [-2^63, 2^63-1]. A naive `BigInt('0x' + hex)`
 * yields an UNSIGNED 64-bit value up to 2^64-1, which fails Postgres bigint
 * coercion with `22003 numeric_value_out_of_range` for ~50% of UUIDs (any UUID
 * whose first byte has the high bit set). `BigInt.asIntN(64, value)` preserves
 * the bit pattern (and therefore uniqueness / collision properties) while
 * reinterpreting it as a signed 64-bit integer that always fits in int8.
 *
 * @param {string} uuid - UUID string (e.g. '12345678-1234-1234-1234-123456789012')
 * @returns {BigInt} Deterministic signed bigint lock key (fits in Postgres int8)
 */
export function uuidToBigint (uuid) {
  const hex = uuid.replace(/-/g, '').slice(0, 16); // first 8 bytes
  // Reinterpret as signed int64 so the value always fits in Postgres bigint.
  return BigInt.asIntN(64, BigInt('0x' + hex));
}

/**
 * Attempt to acquire a Postgres advisory lock for the given customer marketplace.
 * Uses `pg_try_advisory_lock` which is non-blocking — returns false immediately if
 * the lock is held by another session (no waiting).
 *
 * MUST be called on a dedicated pool client (not pool.query) because advisory locks
 * are session-scoped. The caller is responsible for client.release() in a finally block.
 *
 * @param {import('pg').PoolClient} client - Dedicated pool client (session-scoped)
 * @param {string} customerMarketplaceId - UUID of the customer_marketplace row
 * @returns {Promise<boolean>} true if lock acquired, false if already held by another session
 */
export async function tryAcquireCustomerLock (client, customerMarketplaceId) {
  const lockKey = uuidToBigint(customerMarketplaceId);
  const { rows } = await client.query(
    'SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock',
    [lockKey.toString()]
  );
  return rows[0].pg_try_advisory_lock === true;
}

/**
 * Release the Postgres advisory lock for the given customer marketplace.
 * Calls `pg_advisory_unlock` on the same client that acquired the lock.
 *
 * Note: Postgres advisory locks are also automatically released when the session
 * closes, so this is a best-effort explicit release for well-behaved flows. Crashes
 * are handled automatically by Postgres session cleanup (no manual lock-table needed).
 *
 * @param {import('pg').PoolClient} client - Dedicated pool client that holds the lock
 * @param {string} customerMarketplaceId - UUID of the customer_marketplace row
 * @returns {Promise<void>}
 */
export async function releaseCustomerLock (client, customerMarketplaceId) {
  const lockKey = uuidToBigint(customerMarketplaceId);
  await client.query(
    'SELECT pg_advisory_unlock($1)',
    [lockKey.toString()]
  );
}
