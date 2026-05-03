import { getServiceRoleClient } from '../../../shared/db/service-role-client.js';

const workerId = `${process.env.HOSTNAME || 'local'}:${process.pid}`;

async function writeHeartbeat(logger) {
  try {
    await getServiceRoleClient().query(
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
 *
 * Pool management: uses getServiceRoleClient() from the SSoT module
 * (shared/db/service-role-client.js) which applies buildPgPoolConfig conditional-SSL.
 * This fixes the "The server does not support SSL connections" error that occurred
 * when running against local Supabase (localhost) with the previous hard-coded
 * ssl: { ca: caCert } config. See deferred-work.md Item 0 and Library Empirical
 * Contract #9.
 *
 * @param {import('pino').Logger} logger - Pino logger instance from the worker entry point
 * @returns {void}
 */
export function startHeartbeat(logger) {
  logger.info({ workerId }, 'Heartbeat job started');
  writeHeartbeat(logger);
  setInterval(() => writeHeartbeat(logger), 30_000);
}
