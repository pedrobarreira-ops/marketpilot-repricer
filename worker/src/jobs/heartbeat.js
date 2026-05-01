import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
const { Pool } = pg;

const caCert = fs.readFileSync(path.resolve('supabase/prod-ca-2021.crt'), 'utf8');

const pool = new Pool({
  connectionString: process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL,
  ssl: { ca: caCert },
  max: 5,
});

const workerId = `${process.env.HOSTNAME || 'local'}:${process.pid}`;

async function writeHeartbeat(logger) {
  try {
    await pool.query(
      'INSERT INTO worker_heartbeats (worker_instance_id) VALUES ($1)',
      [workerId]
    );
  } catch (err) {
    logger.error({ err }, 'Heartbeat INSERT failed');
  }
}

/**
 * Starts the periodic worker heartbeat — writes one row immediately, then every 30 seconds.
 * The eager initial write prevents a 30s window after boot during which /health is 503.
 * @param {import('pino').Logger} logger - Pino logger instance from the worker entry point
 * @returns {void}
 */
export function startHeartbeat(logger) {
  logger.info({ workerId }, 'Heartbeat job started');
  writeHeartbeat(logger);
  setInterval(() => writeHeartbeat(logger), 30_000);
}
