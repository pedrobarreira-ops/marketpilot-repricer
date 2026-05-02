import { test } from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import {
  createWorkerLogger,
  getFastifyLoggerOptions,
  getRedactPaths,
  getRedactCensor,
  FASTIFY_REQUEST_ID_LOG_LABEL,
} from '../../shared/logger.js';

/**
 * Construct a logger that writes to an in-memory array. Returns
 * { logger, lines } so tests can assert on emitted output.
 *
 * Pino accepts a custom destination as the second positional arg; the object
 * needs only a `write(chunk)` method to satisfy the WritableLike contract.
 */
function makeCapturedLogger (opts = {}) {
  const lines = [];
  const stream = { write (chunk) { lines.push(chunk); } };
  const logger = pino(opts, stream);
  return { logger, lines };
}

const AD27_FIELDS = [
  'Authorization', 'authorization',
  'Cookie', 'cookie',
  'Set-Cookie', 'set-cookie',
  'password', 'password_hash',
  'shop_api_key', 'master_key', 'MASTER_KEY_BASE64',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY',
];

/**
 * Re-derive the worker-equivalent pino options from the SSoT exports so the
 * captured-stream tests use the SAME redaction list the production factory
 * uses, without reading pino internals via Symbol(...) (brittle across pino
 * versions). `level: 'trace'` is a test-only override so all levels emit.
 */
function pickPinoOpts () {
  return {
    level: 'trace',
    redact: { paths: getRedactPaths(), censor: getRedactCensor() },
    base: { context: 'worker', pid: process.pid, hostname: 'test-host' },
    formatters: { level (label) { return { level: label }; } },
  };
}

test('redacts top-level shop_api_key', () => {
  const { logger, lines } = makeCapturedLogger(pickPinoOpts());
  logger.info({ shop_api_key: 'SECRET_VALUE' }, 'log');
  const record = JSON.parse(lines[0]);
  assert.equal(record.shop_api_key, '[REDACTED]');
  assert.ok(!lines[0].includes('SECRET_VALUE'), 'sentinel leaked');
});

test('redacts nested shop_api_key one level deep', () => {
  const { logger, lines } = makeCapturedLogger(pickPinoOpts());
  logger.info({ payload: { shop_api_key: 'SECRET_VALUE' } }, 'log');
  const record = JSON.parse(lines[0]);
  assert.equal(record.payload.shop_api_key, '[REDACTED]');
  assert.ok(!lines[0].includes('SECRET_VALUE'));
});

test('redacts Fastify req.headers.authorization', () => {
  const fastifyOpts = getFastifyLoggerOptions();
  const { logger, lines } = makeCapturedLogger(fastifyOpts);
  logger.info({ req: { headers: { authorization: 'Bearer SECRET' } } }, 'req log');
  const record = JSON.parse(lines[0]);
  assert.equal(record.req.headers.authorization, '[REDACTED]');
  assert.ok(!lines[0].includes('Bearer SECRET'));
});

test('redacts each AD27 field name (parameterized, top-level)', () => {
  for (const field of AD27_FIELDS) {
    const { logger, lines } = makeCapturedLogger(pickPinoOpts());
    const sentinel = `SENTINEL_${field}`;
    logger.info({ [field]: sentinel }, 'log');
    const record = JSON.parse(lines[0]);
    assert.equal(record[field], '[REDACTED]', `top-level ${field} not redacted`);
    assert.ok(!lines[0].includes(sentinel), `sentinel leaked for top-level ${field}`);
  }
});

test('redacts each AD27 field name nested one level (parameterized)', () => {
  for (const field of AD27_FIELDS) {
    const { logger, lines } = makeCapturedLogger(pickPinoOpts());
    const sentinel = `SENTINEL_NESTED_${field}`;
    logger.info({ payload: { [field]: sentinel } }, 'log');
    const record = JSON.parse(lines[0]);
    assert.equal(record.payload[field], '[REDACTED]', `nested ${field} not redacted`);
    assert.ok(!lines[0].includes(sentinel), `sentinel leaked for nested ${field}`);
  }
});

test('output is valid newline-delimited JSON with required base fields', () => {
  const { logger, lines } = makeCapturedLogger(pickPinoOpts());
  logger.info('one'); logger.info('two'); logger.info('three');
  assert.equal(lines.length, 3);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const record = JSON.parse(trimmed);
    assert.ok('level' in record);
    assert.ok('time' in record);
    assert.ok('context' in record);
    assert.ok('pid' in record);
    assert.ok('hostname' in record);
  }
});

test('level field is a string label, not numeric', () => {
  const { logger, lines } = makeCapturedLogger(pickPinoOpts());
  logger.info('info-level message');
  const record = JSON.parse(lines[0]);
  assert.equal(record.level, 'info');
});

test('worker logger has context: "worker" base field', () => {
  const { logger, lines } = makeCapturedLogger(pickPinoOpts());
  logger.info('hello');
  const record = JSON.parse(lines[0]);
  assert.equal(record.context, 'worker');
});

test('Fastify options have context: "app" and request_id label', () => {
  const opts = getFastifyLoggerOptions();
  assert.equal(opts.base.context, 'app');
  assert.equal(FASTIFY_REQUEST_ID_LOG_LABEL, 'request_id');
});

test('redact paths and censor exposed for verification (top-level + wildcard + req.headers)', () => {
  const paths = getRedactPaths();
  const censor = getRedactCensor();
  assert.equal(censor, '[REDACTED]');
  for (const field of AD27_FIELDS) {
    const expectedTopLevel = field.includes('-') ? `["${field}"]` : field;
    assert.ok(paths.includes(expectedTopLevel), `missing top-level path for ${field}`);
    // Defense-in-depth: also assert the wildcard variant for one-level-nested
    // redaction is present. A regression that drops the wildcard branch in
    // buildRedactPaths would otherwise only be caught by the parameterized
    // nested-redaction tests; this assertion catches it directly.
    const expectedWildcard = field.includes('-') ? `*["${field}"]` : `*.${field}`;
    assert.ok(paths.includes(expectedWildcard), `missing wildcard path for ${field}`);
  }
  // Explicit Fastify request-header paths (req.headers.<field> is two levels
  // deep, beyond the *.<field> wildcard's reach).
  assert.ok(paths.includes('req.headers.authorization'), 'missing req.headers.authorization');
  assert.ok(paths.includes('req.headers.cookie'), 'missing req.headers.cookie');
  assert.ok(paths.includes('req.headers["set-cookie"]'), 'missing req.headers["set-cookie"]');
});

test('redacts Fastify req.headers.cookie', () => {
  const fastifyOpts = getFastifyLoggerOptions();
  const { logger, lines } = makeCapturedLogger(fastifyOpts);
  logger.info({ req: { headers: { cookie: 'session=SECRET' } } }, 'req log');
  const record = JSON.parse(lines[0]);
  assert.equal(record.req.headers.cookie, '[REDACTED]');
  assert.ok(!lines[0].includes('session=SECRET'));
});

test('redacts Fastify req.headers["set-cookie"]', () => {
  const fastifyOpts = getFastifyLoggerOptions();
  const { logger, lines } = makeCapturedLogger(fastifyOpts);
  logger.info({ req: { headers: { 'set-cookie': 'token=SECRET' } } }, 'req log');
  const record = JSON.parse(lines[0]);
  assert.equal(record.req.headers['set-cookie'], '[REDACTED]');
  assert.ok(!lines[0].includes('token=SECRET'));
});

test('createWorkerLogger() returns a working pino logger instance', () => {
  const logger = createWorkerLogger();
  assert.equal(typeof logger.info, 'function');
  assert.equal(typeof logger.error, 'function');
  assert.equal(typeof logger.child, 'function');
});
