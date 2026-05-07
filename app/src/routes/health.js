import { getServiceRoleClient } from '../../../shared/db/service-role-client.js';

/**
 * Registers the /health route on the Fastify instance.
 * Public endpoint — no auth middleware applied (FR45, pinged by UptimeRobot).
 * Returns 200 when both Postgres and the worker heartbeat are healthy,
 * 503 with degraded details otherwise.
 *
 * Pool management: uses getServiceRoleClient() from the SSoT module
 * (shared/db/service-role-client.js). The inline pg.Pool from Story 1.1
 * is absorbed here as part of Story 2.1's pool consolidation. Pool teardown
 * is handled by app/src/server.js Fastify onClose hook → closeServiceRolePool().
 *
 * @param {import('fastify').FastifyInstance} fastify - The Fastify server instance
 * @param {object} _opts - Fastify plugin options (unused)
 * @returns {Promise<void>}
 */
export async function healthRoutes(fastify, _opts) {
  fastify.get('/health', { config: { skipAuth: true } }, async (_request, reply) => {
    const result = { status: 'healthy', details: {} };
    let httpStatus = 200;

    const pool = getServiceRoleClient();

    // (a) DB liveness — SELECT 1, cancelled by Pool's statement_timeout after 5s
    try {
      await pool.query('SELECT 1');
      result.details.db = 'ok';
    } catch (err) {
      result.details.db = 'error';
      result.details.db_error = err?.message ?? 'unknown';
      result.status = 'degraded';
      httpStatus = 503;
    }

    // (b) Worker heartbeat freshness — must be in the range [0, 90) seconds
    try {
      const { rows } = await pool.query(
        'SELECT EXTRACT(EPOCH FROM (NOW() - MAX(written_at))) AS age_s FROM worker_heartbeats'
      );
      const raw = rows[0]?.age_s ?? null;
      const ageNum = raw !== null ? Number(raw) : null;
      result.details.worker_heartbeat_age_s = ageNum;
      if (ageNum === null || ageNum < 0 || ageNum >= 90) {
        result.status = 'degraded';
        httpStatus = 503;
        // Negative age means the worker is writing future-dated rows relative to NOW() —
        // surface clock skew explicitly so it isn't silently masked as "ok".
        if (ageNum !== null && ageNum < 0) {
          result.details.clock_skew = true;
        }
      }
    } catch {
      result.details.worker_heartbeat_age_s = null;
      result.status = 'degraded';
      httpStatus = 503;
    }

    return reply
      .code(httpStatus)
      .header('Cache-Control', 'no-store')
      .send(result);
  });
}
