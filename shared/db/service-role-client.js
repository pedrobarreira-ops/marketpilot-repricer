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
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

// Resolve the CA cert relative to THIS module's location, not the process CWD.
// path.resolve('supabase/...') would crash if the worker/app starts from a
// different CWD (e.g., a Docker layer that does not mount the repo root).
// fileURLToPath(import.meta.url) gives the absolute path to this file at boot.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CA_CERT_PATH = path.resolve(__dirname, '..', '..', 'supabase', 'prod-ca-2021.crt');

let _caCert = null;

/**
 * Lazily reads the Supabase CA certificate from disk on first non-local
 * connection. Cached after the first read. Localhost connections never need
 * the cert and never trigger the read — important for Docker images that omit
 * the cert file in local-test layers.
 *
 * @returns {string} PEM-encoded CA certificate
 */
function loadCaCert () {
  if (_caCert === null) {
    _caCert = fs.readFileSync(CA_CERT_PATH, 'utf8');
  }
  return _caCert;
}

/**
 * Build a pg Pool config with environment-appropriate SSL settings.
 * Local Postgres (localhost/127.0.0.1) does not support SSL.
 * Supabase Cloud requires SSL with CA pinning.
 *
 * Library Empirical Contract #9 canonical helper — centralises the
 * localhost detection that was previously copy-pasted across health.js,
 * heartbeat.js, and founder-admin-only.js.
 *
 * The caCertStr argument is optional. When omitted (or null), the cert is
 * read lazily from disk only for non-localhost connections — local tests do
 * not require the cert to be present on disk.
 *
 * @param {string} connectionString - postgres:// connection URL
 * @param {string|null} [caCertStr=null] - PEM-encoded CA certificate (ignored for localhost; lazy-loaded if null)
 * @param {object} [opts={}] - Additional pool config (max, statement_timeout, etc.)
 * @returns {object} pg Pool constructor config
 */
export function buildPgPoolConfig (connectionString, caCertStr = null, opts = {}) {
  const isLocal =
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1');
  if (isLocal) return { connectionString, ...opts };
  const ca = caCertStr ?? loadCaCert();
  return { connectionString, ssl: { ca }, ...opts };
}

let _pool = null;
let _initPromise = null;

/**
 * Construct the service-role pool — extracted so the singleton accessor can
 * memoise the in-flight init under a one-shot promise (prevents the
 * first-call race where two parallel callers each create a Pool and one is
 * leaked).
 *
 * @returns {import('pg').Pool} a fully wired service-role pg Pool
 */
function buildPool () {
  const pool = new Pool(buildPgPoolConfig(
    process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL,
    null,
    { max: 5, statement_timeout: 5000 }
  ));
  // pg.Pool best practice: handle idle-client errors to prevent uncaught-
  // exception crash when a TCP connection drops between queries.
  // ESLint no-console exception: pool error handler is an emergency safety net
  // that fires on idle-client TCP drops — not a normal log path. The shared
  // pino logger cannot be safely imported here at module scope without a
  // potential circular dependency. Using process.stderr directly via console.error
  // is the standard pg pool error-handler pattern.
  pool.on('error', (err) => {
    console.error('[service-role-client] pool idle client error — unreleased client or network drop:', err.message); // eslint-disable-line no-console
  });
  return pool;
}

/**
 * Returns the lazily-initialised service-role pg.Pool singleton.
 * All callers (worker, health route, admin middleware, rls-aware-client)
 * share this single pool — max: 5 connections, statement_timeout: 5000ms.
 *
 * Lazy init so SUPABASE_SERVICE_ROLE_DATABASE_URL need not be set at
 * module-import time (test scenarios that stub env after import).
 *
 * Concurrency-safe: the first call's pool construction is memoised on
 * `_initPromise` (synchronously assigned before any await), so any parallel
 * caller arriving during the same tick observes the in-flight construction
 * and shares the resulting pool. Without this guard, two parallel first-
 * callers would each construct a Pool and one would be leaked (never
 * `.end()`d) — the exact failure mode flagged in deferred-work.md for the
 * absorbed `founder-admin-only.js` getPool helper.
 *
 * @returns {import('pg').Pool} the service-role pool singleton
 */
export function getServiceRoleClient () {
  if (_pool !== null) return _pool;
  if (_initPromise === null) {
    // Synchronous assignment of the singleton — `new Pool(...)` is sync; no
    // await happens before _pool is set, so subsequent callers in the same
    // tick see the populated _pool. The _initPromise is kept only for the
    // symmetry needed if buildPool ever becomes async.
    _pool = buildPool();
    _initPromise = Promise.resolve(_pool);
  }
  return _pool;
}

/**
 * Gracefully close the service-role pool and reset the singleton.
 * Called by SIGTERM/SIGINT handlers (worker) and Fastify onClose hook (app).
 *
 * Idempotent + crash-safe: nullifies the singleton in `finally` so a
 * `_pool.end()` rejection does not strand a dead pool reference. A second
 * call after a rejected end() is a no-op rather than retrying against the
 * already-closed pool (which would itself reject with "Called end on pool
 * more than once").
 *
 * @returns {Promise<void>} resolves once the pool is fully drained (or rejects with end()'s error after the singleton is cleared)
 */
export async function closeServiceRolePool () {
  if (_pool === null) return;
  const poolToClose = _pool;
  _pool = null;
  _initPromise = null;
  await poolToClose.end();
}
