// shared/logger.js — AD27 SSoT (Story 1.3)
//
// Single source of truth for the pino redaction list and structured-log shape.
// Both the worker process (createWorkerLogger) and the Fastify app server
// (getFastifyLoggerOptions consumed by Fastify({ logger: ... })) share REDACT_CONFIG.
//
// Forward dependencies:
//   - Story 2.1 RLS middleware binds customer_marketplace_id via request.log.child({...})
//   - Story 5.1 master-cron dispatcher binds cycle_id via logger.child({...})
//   - Story 9.0 writeAuditEvent emits log lines with event_type field
// Story 1.3 ships only the factory + redaction + base context + request_id label;
// per-request / per-cycle / per-event bindings are downstream child-logger work.
import pino from 'pino';
import { hostname } from 'node:os';

/**
 * AD27 redaction list — NEVER narrow; only extend (and extend ONLY by amending
 * the architecture distillate first, then propagating here).
 *
 * pino's `redact.paths` matches paths exactly. To cover both top-level
 * (e.g., `{ shop_api_key: '...' }`) AND single-level-nested
 * (e.g., `{ payload: { shop_api_key: '...' } }`) AND Fastify's
 * `req.headers.authorization` shape, we enumerate three families:
 *   1. The raw field name (top-level)
 *   2. Single-wildcard `*.<field>` (one level of nesting)
 *   3. Explicit Fastify request paths (`req.headers.authorization`, etc.)
 *
 * pino does NOT support recursive `**.<field>` wildcards. Multi-level nesting
 * beyond depth 1 is an explicit non-goal at MVP — log objects deeper than
 * one level are review-time concerns.
 */
const AD27_FIELDS = Object.freeze([
  // Both header-casing forms for cookie/auth — HTTP headers come in lowercase
  // from Node's http parser, but Fastify-side or ad-hoc code may construct
  // log objects with the capitalized form. Cover both deterministically.
  'Authorization',
  'authorization',
  'Cookie',
  'cookie',
  'Set-Cookie',
  'set-cookie',
  'password',
  'password_hash',
  'shop_api_key',
  'master_key',
  'MASTER_KEY_BASE64',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
]);

/**
 * Build pino path strings for top-level + one-level-nested redaction.
 * Bracket notation is used for hyphenated keys (e.g., `set-cookie`) so pino's
 * fast-redact path parser doesn't choke on the dash.
 * @returns {string[]} pino redact-path entries covering depth-0 + depth-1 + Fastify req.headers.*
 */
function buildRedactPaths () {
  const paths = [];
  for (const field of AD27_FIELDS) {
    const safeKey = /[^A-Za-z0-9_]/.test(field) ? `["${field}"]` : field;
    // Top-level: `shop_api_key` or `["set-cookie"]`
    paths.push(field.includes('-') ? `["${field}"]` : field);
    // One-level nested wildcard: `*.shop_api_key` or `*["set-cookie"]`
    paths.push(field.includes('-') ? `*${safeKey}` : `*.${field}`);
  }
  // Fastify request-serializer paths — explicit because Fastify builds
  // `req.headers.<lowercase>` (Node's http parser lowercases headers); the
  // wildcard `*.<field>` family above covers `req.<field>`, but
  // `req.headers.<field>` is two levels deep so it needs an explicit entry.
  // We list only the lowercase form here because Node's parser guarantees that
  // shape on inbound requests.
  paths.push('req.headers.authorization');
  paths.push('req.headers.cookie');
  paths.push('req.headers["set-cookie"]');
  return paths;
}

const REDACT_PATHS = Object.freeze(buildRedactPaths());
const REDACT_CENSOR = '[REDACTED]';

const REDACT_CONFIG = Object.freeze({
  paths: REDACT_PATHS,
  censor: REDACT_CENSOR,
});

// LOG_LEVEL validation — pino throws synchronously at construction if the
// level is unknown. Because `createWorkerLogger()` runs at module-import time
// (via shared/config/runtime-env.js), a typo in the Coolify env config would
// crash boot before any error handler exists. Validate against pino's known
// set and fall back to 'info' (with a warn-level log line emitted by the
// factory at first construction) so the process boots and the misconfig is
// observable in stdout.
const VALID_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);
const REQUESTED_LOG_LEVEL = process.env.LOG_LEVEL;
const LOG_LEVEL_INVALID = REQUESTED_LOG_LEVEL !== undefined && REQUESTED_LOG_LEVEL !== '' && !VALID_LOG_LEVELS.has(REQUESTED_LOG_LEVEL);
const LOG_LEVEL = LOG_LEVEL_INVALID ? 'info' : (REQUESTED_LOG_LEVEL || 'info');

// pino's `base` option REPLACES the default base ({ pid, hostname }) entirely.
// AC#2 requires every record to carry `pid` and `hostname` alongside `context`,
// so we re-include them explicitly when composing the per-process base.
const HOSTNAME = hostname();
const PID = process.pid;

/**
 * Format the level field as a string label (e.g., 'info') instead of pino's
 * default numeric level (30). Easier for humans + most log aggregators expect
 * the string form.
 */
const FORMATTERS = Object.freeze({
  level (label) { return { level: label }; },
});

/**
 * Re-exports for unit-test access. Tests assert the EXACT path list and censor
 * string match the AD27 contract; do not mutate at runtime.
 * @returns {readonly string[]} frozen redaction-paths array
 */
export function getRedactPaths () {
  return REDACT_PATHS;
}

/**
 * @returns {string} the censor sentinel pino substitutes for matched paths
 */
export function getRedactCensor () {
  return REDACT_CENSOR;
}

/**
 * Worker-side pino factory. Holds the logger instance for the lifetime of the
 * worker process. Story 5.1 will create per-cycle child loggers via
 * `workerLogger.child({ cycle_id })`; Story 1.3 ships only the parent.
 *
 * @returns {import('pino').Logger} configured pino logger with AD27 redaction
 *   and `base: { context: 'worker' }`.
 */
export function createWorkerLogger () {
  const logger = pino({
    level: LOG_LEVEL,
    redact: REDACT_CONFIG,
    base: { context: 'worker', pid: PID, hostname: HOSTNAME },
    formatters: FORMATTERS,
  });
  if (LOG_LEVEL_INVALID) {
    logger.warn(
      { requested_log_level: REQUESTED_LOG_LEVEL, fallback: 'info' },
      'LOG_LEVEL invalid; falling back to info',
    );
  }
  return logger;
}

/**
 * Fastify v5 top-level constructor option for the request-id JSON field name.
 * Fastify defaults this to `'reqId'`; AD27/AC#2 require the spec name
 * `request_id`. NOTE: this is a Fastify constructor option, NOT a pino option
 * — it must be passed at the root of `Fastify({ ... })`, not inside `logger:`.
 */
export const FASTIFY_REQUEST_ID_LOG_LABEL = 'request_id';

/**
 * Fastify-side pino options. Fastify constructs its own pino instance from
 * this object (it doesn't accept a pre-built logger). The shape mirrors
 * `createWorkerLogger`'s pino opts.
 *
 * Usage in app/src/server.js:
 *   import { getFastifyLoggerOptions, FASTIFY_REQUEST_ID_LOG_LABEL }
 *     from '../../shared/logger.js';
 *   const fastify = Fastify({
 *     logger: getFastifyLoggerOptions(),
 *     requestIdLogLabel: FASTIFY_REQUEST_ID_LOG_LABEL,
 *   });
 *
 * @returns {object} Fastify `logger:` config object
 */
export function getFastifyLoggerOptions () {
  return {
    level: LOG_LEVEL,
    redact: REDACT_CONFIG,
    base: { context: 'app', pid: PID, hostname: HOSTNAME },
    formatters: FORMATTERS,
  };
}
