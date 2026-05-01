import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
const { Pool } = pg;

const caCert = fs.readFileSync(path.resolve('supabase/prod-ca-2021.crt'), 'utf8');

const pool = new Pool({
  connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL,
  ssl: { ca: caCert },
  max: 2,
  // Server-side cancel after 1s. Replaces the previous Promise.race wrapper, which
  // resolved the race but left the underlying pg query running and pinning a pool slot.
  statement_timeout: 1000,
});

/**
 * Registers the /health route on the Fastify instance.
 * Public endpoint — no auth middleware applied (FR45, pinged by UptimeRobot).
 * Returns 200 when both Postgres and the worker heartbeat are healthy,
 * 503 with degraded details otherwise.
 * @param {import('fastify').FastifyInstance} fastify - The Fastify server instance
 * @param {object} _opts - Fastify plugin options (unused)
 * @returns {Promise<void>}
 */
export async function healthRoutes(fastify, _opts) {
  fastify.get('/health', { config: { skipAuth: true } }, async (_request, reply) => {
    const result = { status: 'healthy', details: {} };
    let httpStatus = 200;

    // (a) DB liveness — SELECT 1, cancelled by Pool's statement_timeout after 1s
    try {
      await pool.query('SELECT 1');
      result.details.db = 'ok';
    } catch {
      result.details.db = 'error';
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
