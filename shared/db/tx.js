// shared/db/tx.js
//
// Transaction helper for Postgres operations via the service-role pool.
// Provides BEGIN/COMMIT/ROLLBACK semantics with automatic client checkout
// when a pool (rather than an already-checked-out client) is passed.
//
// Nesting decision (AC#3, Option A chosen):
// tx() rejects nested transactions with TransactionNestingError rather than
// implementing savepoints. Rationale: savepoints require tracking nesting
// depth and SAVEPOINT names; the simple rejection makes misuse loud and
// immediately visible rather than silently producing surprising semantics.
// Callers that need savepoints must implement them explicitly.

/**
 * Error thrown when tx() is called with a client that is already inside
 * an active Postgres transaction.
 *
 * @extends {Error}
 */
export class TransactionNestingError extends Error {
  /**
   * @param {string} [message] - optional override message
   */
  constructor (message = 'tx() does not support nested transactions — use savepoints explicitly') {
    super(message);
    this.name = 'TransactionNestingError';
  }
}

/**
 * Wraps a callback in a Postgres transaction.
 * Commits on success; rolls back and re-throws on any Error.
 *
 * Nesting: throws TransactionNestingError if the supplied client is already
 * inside an active transaction. Callers that need nested transactions must
 * use Postgres savepoints directly.
 *
 * Nesting-detection limitation: detection relies on the `_txActive` sentinel
 * property that tx() itself manages. A caller that issues BEGIN manually on
 * a PoolClient and then calls tx() with that same client will NOT trigger the
 * nesting error — Postgres will silently NOTICE "there is already a
 * transaction in progress" on the inner BEGIN, and the inner COMMIT will
 * commit the outer transaction prematurely. Callers MUST NOT mix manual
 * BEGIN/COMMIT with tx(); use one or the other on a given client lifetime.
 * The tx()-from-tx() nesting case (the realistic misuse) IS detected.
 *
 * Advisory-lock compatibility: if a pg.Pool is passed instead of a client,
 * a client is checked out from the pool before BEGIN and released on
 * COMMIT/ROLLBACK.
 *
 * Caller-managed-client contract: when a checked-out PoolClient is passed
 * (rather than a Pool), the caller is responsible for the connection
 * lifecycle. If tx() throws, the caller MUST treat the connection as
 * potentially poisoned and discard it — release with an error flag
 * (`client.release(err)`) so the pool removes the connection rather than
 * recycling it. ROLLBACK can fail (network drop, server-side abort) and
 * leave the connection in PG transaction-aborted state (error 25P02 on the
 * next query); without `release(err)`, the next pool checkout would inherit
 * that broken state. When tx() owns the checkout (Pool passed in), it
 * handles this internally — the contract only matters for the
 * caller-managed path.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} client - pg client or pool
 * @param {function(import('pg').PoolClient): Promise<*>} callback - work to run inside transaction
 * @returns {Promise<*>} - result of callback
 * @throws {TransactionNestingError} - if client is already inside a transaction
 * @throws {Error} - re-throws callback error after issuing ROLLBACK
 */
export async function tx (client, callback) {
  // If a Pool is passed, check out a client first.
  // Distinguish Pool from PoolClient: a PoolClient (checked out via pool.connect())
  // has a release() method; a Pool does not. Both have connect(), so we use release()
  // as the discriminator.
  let txClient = client;
  let mustRelease = false;

  if (typeof client.release !== 'function') {
    // It's a Pool (no release method) — check out a client
    txClient = await client.connect();
    mustRelease = true;
  }

  // Nesting detection (Option A): track an `_txActive` sentinel property that
  // tx() sets on the client after BEGIN and clears in `finally`. Reliable for
  // the tx()-from-tx() nesting case (the realistic misuse). For the limitation
  // around manual-BEGIN-then-tx(), see the JSDoc above.
  if (txClient._txActive === true) {
    if (mustRelease) txClient.release();
    throw new TransactionNestingError();
  }

  let releaseErr; // set if rollback or callback raises a connection-level error
  try {
    txClient._txActive = true;
    await txClient.query('BEGIN');
    const result = await callback(txClient);
    await txClient.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await txClient.query('ROLLBACK');
    } catch (rollbackErr) {
      // ROLLBACK failure means the underlying connection is likely poisoned
      // (network drop, server-side abort). Capture so the finally block can
      // release with an error flag — pg.Pool then discards the connection
      // rather than returning it to the idle pool. Without this flag, the
      // next pool.connect() can hand out a connection still mid-aborted-tx,
      // producing 25P02 "current transaction is aborted" on the next query.
      releaseErr = rollbackErr;
    }
    throw err;
  } finally {
    txClient._txActive = false;
    if (mustRelease) {
      // Pass releaseErr so a poisoned connection is discarded by the pool.
      // Undefined when COMMIT/ROLLBACK both succeeded — pool reuses the
      // connection normally.
      txClient.release(releaseErr);
    }
  }
}
