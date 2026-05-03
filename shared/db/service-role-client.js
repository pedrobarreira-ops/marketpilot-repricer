// shared/db/service-role-client.js
//
// SSoT module for the service-role Postgres pool.
// Centralises all raw pg access, conditional-SSL logic, and SIGTERM teardown
// in one place. All other callers import from here — never instantiate
// pg.Pool directly (ESLint no-direct-pg-in-app enforces this in app/src/).
//
// Library Empirical Contract #8: ESM-safe pg import.
// Library Empirical Contract #9: conditional-SSL based on connection-string host.

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

const caCert = fs.readFileSync(path.resolve('supabase/prod-ca-2021.crt'), 'utf8');

/**
 * Build a pg Pool config with environment-appropriate SSL settings.
 * Local Postgres (localhost/127.0.0.1) does not support SSL.
 * Supabase Cloud requires SSL with CA pinning.
 *
 * Library Empirical Contract #9 canonical helper — centralises the
 * localhost detection that was previously copy-pasted across health.js,
 * heartbeat.js, and founder-admin-only.js.
 *
 * @param {string} connectionString - postgres:// connection URL
 * @param {string} caCertStr - PEM-encoded CA certificate (ignored for localhost)
 * @param {object} [opts={}] - Additional pool config (max, statement_timeout, etc.)
 * @returns {object} pg Pool constructor config
 */
export function buildPgPoolConfig (connectionString, caCertStr, opts = {}) {
  const isLocal =
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1');
  return isLocal
    ? { connectionString, ...opts }
    : { connectionString, ssl: { ca: caCertStr }, ...opts };
}

let _pool = null;

/**
 * Returns the lazily-initialised service-role pg.Pool singleton.
 * All callers (worker, health route, admin middleware, rls-aware-client)
 * share this single pool — max: 5 connections, statement_timeout: 5000ms.
 *
 * Lazy init so SUPABASE_SERVICE_ROLE_DATABASE_URL need not be set at
 * module-import time (test scenarios that stub env after import).
 *
 * @returns {import('pg').Pool} the service-role pool singleton
 */
export function getServiceRoleClient () {
  if (_pool === null) {
    _pool = new Pool(buildPgPoolConfig(
      process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL,
      caCert,
      { max: 5, statement_timeout: 5000 }
    ));
    // pg.Pool best practice: handle idle-client errors to prevent uncaught-
    // exception crash when a TCP connection drops between queries.
    // ESLint no-console exception: pool error handler is an emergency safety net
    // that fires on idle-client TCP drops — not a normal log path. The shared
    // pino logger cannot be safely imported here at module scope without a
    // potential circular dependency. Using process.stderr directly via console.error
    // is the standard pg pool error-handler pattern.
    _pool.on('error', (err) => {
      console.error('[service-role-client] pool idle client error — unreleased client or network drop:', err.message); // eslint-disable-line no-console
    });
  }
  return _pool;
}

/**
 * Gracefully close the service-role pool and reset the singleton.
 * Called by SIGTERM/SIGINT handlers (worker) and Fastify onClose hook (app).
 *
 * @returns {Promise<void>} resolves once the pool is fully drained
 */
export async function closeServiceRolePool () {
  if (_pool !== null) {
    await _pool.end();
    _pool = null;
  }
}
