// Story 1.5 — founder-admin gate preHandler.
//
// Composed on top of authMiddleware (must be wired AFTER authMiddleware in
// the route group's preHandler chain). Reads request.user.email (set by
// auth.js), looks it up against the founder_admins allow-list via a
// service-role pg.Pool, and decorates request.adminContext = {email} on
// success. Returns 403 + admin-denied.eta on absence; 503 on lookup error.
//
// AD4 — founder admin read-only:
//   The lookup uses a service-role connection (bypasses RLS by design;
//   founder_admins has RLS DISABLED — see migration 202604301202). Constraint
//   #13 — the founder NEVER logs in as the customer; admin status is binary
//   and DB-driven (no JWT custom claim, no role column, no team table).
//
// Story 2.1: inline pg.Pool absorbed into shared/db/service-role-client.js.
// getFounderAdminPool and endFounderAdminPool preserved as named exports for
// test teardown compatibility (admin-middleware.test.js calls pool.end() via
// these exports). Both now delegate to the SSoT module.
//
// GDPR PII consideration: email_attempted is plaintext at MVP. Phase 2
// trigger (>5 denials/year OR GDPR audit ask): switch to first 8 hex chars of
// crypto.createHash('sha256').update(email).digest('hex') — sufficient for
// log correlation, irreversible. Tracked in deferred-work.md.

import { getServiceRoleClient, closeServiceRolePool } from '../../../shared/db/service-role-client.js';

/**
 * Founder-admin gate preHandler. Composed on top of authMiddleware (which
 * MUST be registered as a prior preHandler hook on the same route group).
 *
 * - On absent founder match: 403 + admin-denied.eta + info-level pino log
 * - On present founder match: decorate request.adminContext = {email}
 * - On lookup error (DB unavailable / statement_timeout): 503 + retry message
 * - On missing request.user (authMiddleware not wired): throws — fail-loud
 *   guard prevents trust regression where founderAdminOnly is wired without
 *   its session-check prerequisite.
 *
 * @param {import('fastify').FastifyRequest} request - Fastify request
 * @param {import('fastify').FastifyReply} reply - Fastify reply
 * @returns {Promise<void>}
 */
export async function founderAdminOnly (request, reply) {
  // Fail-loud guard: prerequisite is authMiddleware. Without it, the gate
  // would silently grant access to any anonymous request — admin bypass is a
  // trust regression. The verbatim error string is asserted by the
  // integration test (founder_admin_only_throws_without_auth_middleware).
  if (!request.user || typeof request.user.email !== 'string') {
    throw new Error('founder-admin-only requires auth.js as a prior preHandler hook on this route');
  }

  // Defense in depth: case-insensitive comparison. Supabase Auth normalizes
  // email to lowercase on signup in current versions, but the contract is not
  // versioned-stable. Comparing lowercase-on-both-sides ensures a mixed-case
  // founder Auth email still matches the lowercase `pedro@marketpilot.pt` seed.
  let rows;
  try {
    const result = await getServiceRoleClient().query(
      'SELECT email FROM founder_admins WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [request.user.email]
    );
    rows = result.rows;
  } catch (err) {
    request.log.error({ err, email: request.user.email }, 'founder-admin lookup failed');
    return reply.code(503).view('pages/admin-denied.eta', {
      messagePt: 'Serviço temporariamente indisponível. Tenta novamente em alguns minutos.',
    });
  }

  if (rows.length === 0) {
    request.log.info(
      { event_type: 'admin_access_denied', customer_marketplace_id: null, email_attempted: request.user.email },
      'admin access denied'
    );
    return reply.code(403).view('pages/admin-denied.eta', {
      messagePt: 'Esta página é apenas para administração.',
    });
  }

  request.adminContext = { email: request.user.email };
}

/**
 * Test-helper exposing the service-role pool for explicit teardown.
 * Tests should call `await endFounderAdminPool()` in their t.after to release
 * connections cleanly between cases.
 *
 * @deprecated delegates to shared/db/service-role-client.js; preserved for
 * admin-middleware.test.js teardown compatibility.
 *
 * @returns {import('pg').Pool} the service-role pool singleton
 */
export function getFounderAdminPool () {
  return getServiceRoleClient();
}

/**
 * Test-helper to fully release the pool and reset the singleton — required
 * after t.after's pool.end() so that subsequent `--test` runs in the same
 * process (or watch mode) get a fresh pool. Safe no-op if pool was never
 * created.
 *
 * @deprecated delegates to shared/db/service-role-client.js; preserved for
 * admin-middleware.test.js teardown compatibility.
 *
 * @returns {Promise<void>} resolves once the pool is closed
 */
export async function endFounderAdminPool () {
  return closeServiceRolePool();
}
