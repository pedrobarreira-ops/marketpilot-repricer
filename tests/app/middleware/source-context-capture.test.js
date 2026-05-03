import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sourceContextCapture,
  readSourceContext,
} from '../../../app/src/middleware/source-context-capture.js';

const COOKIE_NAME = 'mp_source_ctx';

function makeStubLogger () {
  const calls = [];
  return {
    calls,
    warn: (obj, msg) => { calls.push({ level: 'warn', obj, msg }); },
    error: (obj, msg) => { calls.push({ level: 'error', obj, msg }); },
    info: (obj, msg) => { calls.push({ level: 'info', obj, msg }); },
  };
}

function makeStubRequest ({ query = {}, cookies = {}, method = 'GET' } = {}) {
  return {
    query,
    cookies,
    method,
    log: makeStubLogger(),
    // Emulate @fastify/cookie's unsignCookie: in production it strips the
    // signature wrapper from a `s:<value>.<sig>` string. For unit-test
    // purposes we treat the stub `cookies[name]` as already-unwrapped:
    // a non-empty string → {valid: true, value: raw}; `false` → invalid.
    unsignCookie: (raw) => {
      if (raw === false) return { valid: false, value: null };
      if (typeof raw !== 'string') return { valid: false, value: null };
      return { valid: true, value: raw };
    },
  };
}

function makeStubReply () {
  const setCalls = [];
  return {
    setCalls,
    setCookie: (name, value, options) => { setCalls.push({ name, value, options }); },
  };
}

test('sourceContextCapture: source query param → cookie set with source only', async () => {
  const req = makeStubRequest({ query: { source: 'free_report' } });
  const reply = makeStubReply();
  await sourceContextCapture(req, reply);
  assert.equal(reply.setCalls.length, 1);
  assert.equal(reply.setCalls[0].name, COOKIE_NAME);
  const parsed = JSON.parse(reply.setCalls[0].value);
  assert.equal(parsed.source, 'free_report');
  assert.equal(parsed.campaign, null);
  assert.equal(reply.setCalls[0].options.signed, true);
  assert.equal(reply.setCalls[0].options.httpOnly, true);
  assert.equal(reply.setCalls[0].options.sameSite, 'lax');
  assert.equal(reply.setCalls[0].options.path, '/');
  assert.equal(reply.setCalls[0].options.maxAge, 60 * 60 * 24 * 7);
});

test('sourceContextCapture: campaign query param → cookie set with campaign only', async () => {
  const req = makeStubRequest({ query: { campaign: 'tony_august' } });
  const reply = makeStubReply();
  await sourceContextCapture(req, reply);
  assert.equal(reply.setCalls.length, 1);
  const parsed = JSON.parse(reply.setCalls[0].value);
  assert.equal(parsed.source, null);
  assert.equal(parsed.campaign, 'tony_august');
});

test('sourceContextCapture: both source + campaign → cookie set with both', async () => {
  const req = makeStubRequest({ query: { source: 'free_report', campaign: 'tony_august' } });
  const reply = makeStubReply();
  await sourceContextCapture(req, reply);
  const parsed = JSON.parse(reply.setCalls[0].value);
  assert.equal(parsed.source, 'free_report');
  assert.equal(parsed.campaign, 'tony_august');
});

test('sourceContextCapture: no query params → no-op', async () => {
  const req = makeStubRequest({ query: {} });
  const reply = makeStubReply();
  await sourceContextCapture(req, reply);
  assert.equal(reply.setCalls.length, 0);
});

test('sourceContextCapture: first-write-wins — existing cookie does not get overwritten', async () => {
  const req = makeStubRequest({
    query: { source: 'facebook_ad' },
    cookies: { [COOKIE_NAME]: '{"source":"free_report","campaign":null}' },
  });
  const reply = makeStubReply();
  await sourceContextCapture(req, reply);
  assert.equal(reply.setCalls.length, 0);
});

test('sourceContextCapture: rejects values with control characters (non-printable ASCII)', async () => {
  const req = makeStubRequest({ query: { source: 'free\x00report' } });
  const reply = makeStubReply();
  await sourceContextCapture(req, reply);
  assert.equal(reply.setCalls.length, 0);
});

test('sourceContextCapture: rejects values longer than 100 chars', async () => {
  const req = makeStubRequest({ query: { source: 'a'.repeat(101) } });
  const reply = makeStubReply();
  await sourceContextCapture(req, reply);
  assert.equal(reply.setCalls.length, 0);
});

test('sourceContextCapture: rejects non-string query values', async () => {
  const req = makeStubRequest({ query: { source: ['arr'], campaign: { obj: true } } });
  const reply = makeStubReply();
  await sourceContextCapture(req, reply);
  assert.equal(reply.setCalls.length, 0);
});

test('sourceContextCapture: tampered signed cookie (false) → overwrites with fresh capture, warn logged', async () => {
  // P4: a forged/tampered cookie does NOT block a legitimate capture; it
  // gets overwritten so the attribution can still flow through. The warn
  // log records the signature invalidation for triage.
  const req = makeStubRequest({
    query: { source: 'free_report' },
    cookies: { [COOKIE_NAME]: false },
  });
  const reply = makeStubReply();
  await sourceContextCapture(req, reply);
  assert.equal(reply.setCalls.length, 1, 'forged cookie must be overwritten by legitimate capture');
  assert.equal(req.log.calls.some((c) => c.level === 'warn'), true, 'warn log records the invalidation');
  const parsed = JSON.parse(reply.setCalls[0].value);
  assert.equal(parsed.source, 'free_report');
});

test('sourceContextCapture: POST request → no-op even with ?source query (P5 GET-only gate)', async () => {
  const req = makeStubRequest({
    query: { source: 'free_report', campaign: 'tony_august' },
    method: 'POST',
  });
  const reply = makeStubReply();
  await sourceContextCapture(req, reply);
  assert.equal(reply.setCalls.length, 0, 'POST must not set attribution cookie');
});

test('readSourceContext: returns nulls + logs warn when unsignCookie throws', () => {
  // P10: a future @fastify/cookie validator throw should be a benign
  // null-return, not bubble 500 to the user.
  const req = {
    cookies: { [COOKIE_NAME]: 'some-string' },
    log: makeStubLogger(),
    unsignCookie: () => { throw new Error('boom'); },
  };
  const result = readSourceContext(req);
  assert.equal(result.source, null);
  assert.equal(result.campaign, null);
  assert.equal(req.log.calls.some((c) => c.level === 'warn'), true);
});

test('sourceContextCapture: rejects values with HTML/quote characters (P11 tightened sanitize)', async () => {
  // P11: tightened from printable-ASCII to safe-identifier — < > " ' & rejected
  for (const bad of ['"><script>', "value'with-quote", 'has<bracket', 'amp&here', 'back\\slash']) {
    const req = makeStubRequest({ query: { source: bad } });
    const reply = makeStubReply();
    await sourceContextCapture(req, reply);
    assert.equal(reply.setCalls.length, 0, `must reject "${bad}"`);
  }
});

test('readSourceContext: returns parsed values when cookie is valid JSON', () => {
  const req = makeStubRequest({
    cookies: { [COOKIE_NAME]: '{"source":"free_report","campaign":"tony_august"}' },
  });
  const result = readSourceContext(req);
  assert.equal(result.source, 'free_report');
  assert.equal(result.campaign, 'tony_august');
});

test('readSourceContext: returns nulls when cookie is absent', () => {
  const req = makeStubRequest({ cookies: {} });
  const result = readSourceContext(req);
  assert.equal(result.source, null);
  assert.equal(result.campaign, null);
});

test('readSourceContext: returns nulls + logs warn when cookie is malformed JSON', () => {
  const req = makeStubRequest({ cookies: { [COOKIE_NAME]: 'not-json{' } });
  const result = readSourceContext(req);
  assert.equal(result.source, null);
  assert.equal(result.campaign, null);
  assert.equal(req.log.calls.some((c) => c.level === 'warn'), true);
});

test('readSourceContext: returns nulls + logs warn when signature invalid (unsignCookie returns valid:false)', () => {
  // P4/P10: with explicit unsignCookie, an invalid-signature cookie surfaces
  // as `unsigned.valid === false`. The legacy auto-`false` path is
  // unreachable with explicit unsign, but we keep this case as the
  // canonical signature-invalid coverage.
  const req = {
    cookies: { [COOKIE_NAME]: 'tampered-string' },
    log: makeStubLogger(),
    unsignCookie: () => ({ valid: false, value: null }),
  };
  const result = readSourceContext(req);
  assert.equal(result.source, null);
  assert.equal(result.campaign, null);
  assert.equal(req.log.calls.some((c) => c.level === 'warn'), true);
});

test('readSourceContext: returns nulls when parsed JSON is missing source/campaign keys', () => {
  const req = makeStubRequest({ cookies: { [COOKIE_NAME]: '{"other":"value"}' } });
  const result = readSourceContext(req);
  assert.equal(result.source, null);
  assert.equal(result.campaign, null);
});
