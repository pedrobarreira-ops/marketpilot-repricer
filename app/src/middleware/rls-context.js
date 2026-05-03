// app/src/middleware/rls-context.js
//
// Fastify preHandler middleware that arms the Postgres RLS context for each
// authenticated request. Must run AFTER authMiddleware (Story 1.5) which
// validates the session cookie and decorates request.user with the JWT.
//
// NEVER re-reads the mp_session cookie here — auth.js already extracted and
// validated the access_token. Library Empirical Contract #2: the cookie
// producer is login.js (Story 1.4); the consumer is auth.js (Story 1.5).
// rls-context.js reads request.user.access_token, not the raw cookie.
//
// Pool leak prevention (IN SCOPE Story 2.1): request.db is a pg.PoolClient
// that MUST be client.release()d after each request. Wire releaseRlsClient
// as an onResponse hook alongside this preHandler.
//
// Story 4.x forward-dependency: route handlers read request.db for customer-
// scoped queries. Do not remove from the preHandler chain.

import { getRlsAwareClient } from '../../../shared/db/rls-aware-client.js';

/**
 * Fastify preHandler: extracts the validated JWT from request.user (set by
 * auth.js), arms a Postgres RLS client, and binds it to request.db.
 *
 * Fail-loud guard: if authMiddleware has not run first (request.user absent),
 * throws a descriptive Error so developers catch the misconfiguration
 * immediately rather than silently accessing the DB unauthenticated.
 *
 * @param {import('fastify').FastifyRequest} request - Fastify request
 * @param {import('fastify').FastifyReply} _reply - Fastify reply (unused)
 * @returns {Promise<void>}
 */
export async function rlsContext (request, _reply) {
  // Fail-loud: authMiddleware MUST be wired as a prior preHandler hook.
  // Without it, request.user is undefined and any subsequent DB query would
  // run without RLS scoping — a trust regression.
  if (!request.user || typeof request.user.access_token !== 'string') {
    throw new Error('rls-context requires auth.js as a prior preHandler hook on this route');
  }
  // DO NOT re-read mp_session cookie — auth.js already validated the JWT
  // and set request.user.access_token. Reading the cookie again would violate
  // the producer/consumer contract (Library Empirical Contract #2).
  request.db = await getRlsAwareClient(request.user.access_token);
}

/**
 * Fastify onResponse hook: resets RLS session settings, then releases the
 * pg.PoolClient back to the pool after each request completes. Resetting the
 * JWT claims and role before release prevents cross-request claim leakage when
 * pg pools reuse connections (session-level settings persist across pool.connect()
 * calls on the same underlying TCP connection).
 *
 * Must be wired alongside rlsContext to prevent pool exhaustion.
 *
 * Wire pattern in route group:
 *   instance.addHook('preHandler', rlsContext);
 *   instance.addHook('onResponse', releaseRlsClient);
 *
 * @param {import('fastify').FastifyRequest} request - Fastify request
 * @returns {Promise<void>}
 */
export async function releaseRlsClient (request) {
  if (request.db) {
    // request.db.release() is the wrapped version from getRlsAwareClient() that
    // auto-resets RLS session settings (RESET ROLE + clear request.jwt.claims)
    // before returning the connection to the pool, preventing cross-request
    // JWT claim leakage when connections are reused.
    await request.db.release();
    request.db = null;
  }
}
