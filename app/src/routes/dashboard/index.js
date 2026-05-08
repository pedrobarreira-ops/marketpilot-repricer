// app/src/routes/dashboard/index.js — Story 4.9
//
// GET `/` — Dry-run minimal landing dashboard (DRY_RUN cron_state).
//
// Auth guard (authMiddleware), RLS context (rlsContext), and interception
// redirect (interceptionRedirect) are applied as preHandler hooks.
// The handler that reaches the template render assumes DRY_RUN
// (PROVISIONING customers are redirected by interceptionRedirect before
// reaching this handler — UX-DR2).
//
// Critical constraints (do NOT relax):
//   - No audit event calls (no AD20 event type defined for dashboard landing)
//   - No cron_state transition calls (no state change in Story 4.9)
//   - pino only for logging (req.log)
//   - async/await only (no promise-chain style)
//   - Named export only (no default export)

import { authMiddleware } from '../../middleware/auth.js';
import { rlsContext, releaseRlsClient } from '../../middleware/rls-context.js';
import { interceptionRedirect } from '../../middleware/interception-redirect.js';

/**
 * Bypass-aware authMiddleware wrapper.
 * Skips the real middleware when req.user is already set (unit-test injection).
 *
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 */
async function authMiddlewareConditional (req, reply) {
  if (req.user) {
    // Bypass is test-only — Epic 4 retro Q3 guard. If req.user is truthy outside
    // NODE_ENV=test it means a global preHandler in server.js set it before this
    // route's hooks ran, which would silently skip auth in production.
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('authMiddlewareConditional bypass fired outside NODE_ENV=test — auth would be silently skipped');
    }
    return;
  }
  return authMiddleware(req, reply);
}

/**
 * Bypass-aware rlsContext wrapper.
 * Skips the real middleware when req.db is already set (unit-test injection).
 *
 * @param {import('fastify').FastifyRequest} req
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 */
async function rlsContextConditional (req, reply) {
  if (req.db) {
    // Bypass is test-only — Epic 4 retro Q3 guard.
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('rlsContextConditional bypass fired outside NODE_ENV=test — RLS context would be silently skipped');
    }
    return;
  }
  return rlsContext(req, reply);
}

/**
 * Register GET `/` — minimal dry-run dashboard route.
 * Auth + RLS + interception hooks are applied at plugin scope (encapsulated).
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} _opts
 * @returns {Promise<void>}
 */
export async function dashboardRoutes (fastify, _opts) {
  fastify.addHook('preHandler', authMiddlewareConditional);
  fastify.addHook('preHandler', rlsContextConditional);
  fastify.addHook('preHandler', interceptionRedirect);
  fastify.addHook('onResponse', releaseRlsClient);

  fastify.get('/', async (_req, reply) => {
    return reply.view('pages/dashboard-dry-run-minimal.eta', {});
  });
}
