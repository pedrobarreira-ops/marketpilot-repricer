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
// Library Empirical Contract #3 — pg.Pool against Supabase Cloud requires
// CA pinning at supabase/prod-ca-2021.crt. NEVER use
// ssl: { rejectUnauthorized: false } (insecure — accepts forged certs).
//
// Local Supabase docker (127.0.0.1) uses a self-signed cert that does NOT
// match prod-ca-2021.crt — verification would fail. We disable SSL in that
// case, matching tests/integration/_helpers/reset-auth-tables.js's
// connection pattern. The conditional is keyed on the connection string's
// host, not NODE_ENV, so it stays correct under any test-runner config.
//
// TODO Story 2.1: migrate to shared/db/service-role-client.js once that SSoT
// lands. The inline Pool here will be absorbed into the SSoT module as a
// 1-line import refactor; the local-vs-prod SSL split lives there too.
//
// GDPR PII consideration: email_attempted is plaintext at MVP. Phase 2
// trigger (>5 denials/year OR GDPR audit ask): switch to first 8 hex chars of
// crypto.createHash('sha256').update(email).digest('hex') — sufficient for
// log correlation, irreversible. Tracked in deferred-work.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo-anchored path so the cert resolves regardless of process.cwd() (Docker
// WORKDIR, systemd WorkingDirectory, CI subdir, watch mode).
const CA_CERT_PATH = path.resolve(__dirname, '../../../supabase/prod-ca-2021.crt');

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

let _pool = null;

/**
 * Parse the connection string and return true if the host is a known local
 * Supabase docker target. Substring match would be unsafe — `notlocalhost.com`
 * or `pooler-127.0.0.1-attack.example.com` would trip a regex; we exact-match
 * the URL hostname instead.
 *
 * @param {string} connectionString - postgres:// connection string
 * @returns {boolean} true if host is localhost / 127.0.0.1 / [::1]
 */
function isLocalDbHost (connectionString) {
  try {
    const host = new URL(connectionString).hostname.replace(/^\[|\]$/g, '');
    return LOCAL_DB_HOSTS.has(host);
  } catch {
    return false;
  }
}

/**
 * Lazily instantiate the service-role pg.Pool used by the founder-admin
 * lookup. Lazy because process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL may not
 * be set at module-import time in some test scenarios; resolving env at
 * first call avoids the binding race. Throws fail-loud if the env var is unset
 * — better to fail boot than silently fall back to libpq PG* defaults.
 *
 * @returns {pg.Pool} the cached service-role pool
 */
function getPool () {
  if (_pool === null) {
    const connectionString = process.env.SUPABASE_SERVICE_ROLE_DATABASE_URL;
    if (typeof connectionString !== 'string' || connectionString.length === 0) {
      throw new Error('SUPABASE_SERVICE_ROLE_DATABASE_URL is required for founder-admin-only middleware');
    }
    const isLocalDb = isLocalDbHost(connectionString);
    // Read CA cert lazily and only when actually used — local dev / test envs
    // without the cert file should not crash module import.
    const ssl = isLocalDb ? false : { ca: fs.readFileSync(CA_CERT_PATH, 'utf8') };
    _pool = new Pool({
      connectionString,
      ssl,
      max: 2,                  // small — middleware is per-request and fast
      statement_timeout: 1000, // 1s — admin lookup is keyed scan, sub-ms expected
    });
    // pg.Pool emits 'error' for idle-client failures (TCP drop, server restart);
    // an unhandled emitter 'error' crashes the Node process. The pool auto-
    // re-establishes on the next checkout, and the next request's query catch
    // surfaces a clean error — so swallow here. (Story 2.1 SSoT will route this
    // to the shared logger when shared/db/service-role-client.js lands.)
    _pool.on('error', () => {});
  }
  return _pool;
}

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
    const result = await getPool().query(
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
 * Test-helper exposing the founder-admin pool for explicit teardown. Tests
 * should call `await getFounderAdminPool().end()` in their t.after to release
 * connections cleanly between cases.
 *
 * @returns {pg.Pool} the lazily-instantiated service-role pool
 */
export function getFounderAdminPool () {
  return getPool();
}

/**
 * Test-helper to fully release the pool and reset the singleton — required
 * after t.after's pool.end() so that subsequent `--test` runs in the same
 * process (or watch mode) get a fresh pool. Safe no-op if pool was never
 * created.
 *
 * @returns {Promise<void>} resolves once the pool is closed
 */
export async function endFounderAdminPool () {
  if (_pool !== null) {
    await _pool.end();
    _pool = null;
  }
}
