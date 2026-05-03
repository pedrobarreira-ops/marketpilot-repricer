// Story 1.5 / AC#7 — admin-middleware integration test.
//
// Spawns an in-process Fastify instance via fastify.inject (NOT a real listener
// — Library Empirical Contract #6) wired with the canonical
// [authMiddleware, founderAdminOnly] preHandler chain on a fixture
// /test-admin route, plus a sibling /test-public (no middleware) route to
// verify Fastify plugin encapsulation, plus a /test-admin-bad route wired
// with founderAdminOnly only (no authMiddleware) to test the fail-loud guard.
//
// The test uses Story 1.4's /signup + /login flows to produce a real
// mp_session cookie — full roundtrip through Supabase Auth + the F3 trigger
// + the cookie writer in login.js. Two test customers are created: one
// founder (admin-test@marketpilot.test, seeded into founder_admins per test)
// and one non-founder (customer-test@marketpilot.test).
//
// Local-only: requires .env.test pointing SUPABASE_SERVICE_ROLE_DATABASE_URL
// at a local Supabase docker. The DELETE FROM auth.users + targeted DELETE
// FROM founder_admins between tests preserves Pedro's production seed (which
// also lives in the test DB after the migration applies).
//
// Run with: node --env-file=.env.test --test tests/integration/admin-middleware.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import FastifyCookie from '@fastify/cookie';
import FastifyFormbody from '@fastify/formbody';
import FastifyView from '@fastify/view';
import { Eta } from 'eta';
import { publicRoutes } from '../../app/src/routes/_public/index.js';
import { authMiddleware } from '../../app/src/middleware/auth.js';
import {
  founderAdminOnly,
  endFounderAdminPool,
} from '../../app/src/middleware/founder-admin-only.js';
import {
  resetAuthAndCustomers,
  endResetAuthPool,
  getResetAuthPool,
} from './_helpers/reset-auth-tables.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FOUNDER_TEST_EMAIL = 'admin-test@marketpilot.test';
const NON_FOUNDER_TEST_EMAIL = 'customer-test@marketpilot.test';
const TEST_PASSWORD = 'pa55word-strong-enough';

/**
 * Build a self-contained Fastify instance for the test — same plugin wiring
 * as production (cookie + formbody + view + eta + publicRoutes) plus three
 * fixture route groups exercising the admin-middleware contract.
 *
 * @returns {Promise<import('fastify').FastifyInstance>} ready Fastify instance
 */
async function buildTestServer () {
  const fastify = Fastify({ logger: false });

  await fastify.register(FastifyCookie, {
    secret: process.env.COOKIE_SECRET,
    hook: 'onRequest',
  });
  await fastify.register(FastifyFormbody);
  await fastify.register(FastifyView, {
    engine: { eta: new Eta() },
    templates: join(__dirname, '../../app/src/views'),
    defaultContext: { appName: 'MarketPilot' },
    propertyName: 'view',
    asyncPropertyName: 'viewAsync',
  });

  await fastify.register(publicRoutes);

  // Fixture #1: canonical wiring [authMiddleware, founderAdminOnly] on /test-admin
  await fastify.register(async (instance) => {
    instance.addHook('preHandler', authMiddleware);
    instance.addHook('preHandler', founderAdminOnly);
    instance.get('/test-admin', async (request) => ({
      ok: true,
      adminEmail: request.adminContext.email,
    }));
  });

  // Fixture #2: NO middleware on /test-public — encapsulation verifier
  await fastify.register(async (instance) => {
    instance.get('/test-public', async () => ({ ok: true }));
  });

  // Fixture #3: founderAdminOnly WITHOUT authMiddleware — fail-loud verifier
  await fastify.register(async (instance) => {
    instance.addHook('preHandler', founderAdminOnly);
    instance.get('/test-admin-bad', async () => ({ ok: true }));
  });

  await fastify.ready();
  return fastify;
}

/**
 * POST /signup against the test Fastify with the three required B2B fields
 * and email-confirmation auto-applied via service-role pool. Returns once the
 * user is signed up AND email_confirmed_at is set so /login can authenticate.
 *
 * @param {import('fastify').FastifyInstance} fastify - test Fastify
 * @param {string} email - user email to create
 * @param {string} password - user password
 * @returns {Promise<void>} resolves when user is signed up + confirmed
 */
async function signupAndConfirm (fastify, email, password) {
  const res = await fastify.inject({
    method: 'POST',
    url: '/signup',
    payload: {
      email,
      password,
      first_name: 'Test',
      last_name: 'Admin',
      company_name: 'MarketPilot Test',
    },
  });
  // Either 302 (redirect to /verify-email) or 400 if signup failed — surface body for diagnosis
  assert.equal(res.statusCode, 302, `signup should 302; got ${res.statusCode}: ${res.body.slice(0, 200)}`);

  // Force email_confirmed_at so /login can authenticate without waiting on a
  // real confirmation email. Local Supabase config.toml may not have
  // auto-confirm enabled in every project.
  const pool = getResetAuthPool();
  await pool.query(
    'UPDATE auth.users SET email_confirmed_at = NOW() WHERE email = $1 AND email_confirmed_at IS NULL',
    [email]
  );
}

/**
 * Issue POST /login against the test Fastify and extract the mp_session
 * cookie from the Set-Cookie response header. Returns the raw cookie value
 * (the `name=value` portion only — drops attributes like Path / HttpOnly /
 * Max-Age) ready to be sent on subsequent gated requests.
 *
 * @param {import('fastify').FastifyInstance} fastify - test Fastify
 * @param {string} email - user email
 * @param {string} password - user password
 * @returns {Promise<string>} the mp_session cookie name=value pair
 */
async function loginAndGetSessionCookie (fastify, email, password) {
  const res = await fastify.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password },
  });
  assert.equal(res.statusCode, 302, `login should 302; got ${res.statusCode}: ${res.body.slice(0, 200)}`);
  const setCookies = res.headers['set-cookie'] ?? [];
  const list = Array.isArray(setCookies) ? setCookies : [setCookies];
  const sessionCookie = list.find((c) => typeof c === 'string' && c.startsWith('mp_session='));
  if (!sessionCookie) {
    throw new Error(`login did not Set-Cookie mp_session; got: ${JSON.stringify(list)}`);
  }
  return sessionCookie.split(';')[0];
}

test('admin-middleware integration', async (t) => {
  const fastify = await buildTestServer();
  const pool = getResetAuthPool();

  t.after(async () => {
    await fastify.close();
    await endFounderAdminPool();
    await endResetAuthPool();
  });

  t.beforeEach(async () => {
    await resetAuthAndCustomers();
    // Seed the test-only founder row; preserves Pedro's production seed
    // (pedro@marketpilot.pt) which also lives in the test DB after migration.
    await pool.query(
      "INSERT INTO founder_admins (email) VALUES ($1) ON CONFLICT (email) DO NOTHING",
      [FOUNDER_TEST_EMAIL]
    );
  });

  t.afterEach(async () => {
    await resetAuthAndCustomers();
    await pool.query('DELETE FROM founder_admins WHERE email = $1', [FOUNDER_TEST_EMAIL]);
  });

  await t.test('unauthenticated_request_redirects_to_login_with_next', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/test-admin' });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, `/login?next=${encodeURIComponent('/test-admin')}`);
    assert.equal(res.body, '', 'redirect body must be empty (no route handler executed)');
  });

  await t.test('authenticated_non_founder_returns_403', async () => {
    await signupAndConfirm(fastify, NON_FOUNDER_TEST_EMAIL, TEST_PASSWORD);
    const cookie = await loginAndGetSessionCookie(fastify, NON_FOUNDER_TEST_EMAIL, TEST_PASSWORD);

    const res = await fastify.inject({
      method: 'GET',
      url: '/test-admin',
      headers: { cookie },
    });
    assert.equal(res.statusCode, 403);
    assert.match(res.headers['content-type'] ?? '', /text\/html/);
    assert.ok(
      res.body.includes('Esta página é apenas para administração.'),
      `expected PT denial copy in body; got: ${res.body.slice(0, 300)}`
    );
  });

  await t.test('authenticated_founder_proceeds_with_adminContext', async () => {
    await signupAndConfirm(fastify, FOUNDER_TEST_EMAIL, TEST_PASSWORD);
    const cookie = await loginAndGetSessionCookie(fastify, FOUNDER_TEST_EMAIL, TEST_PASSWORD);

    const res = await fastify.inject({
      method: 'GET',
      url: '/test-admin',
      headers: { cookie },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.adminEmail, FOUNDER_TEST_EMAIL);
  });

  await t.test('founder_admin_only_throws_without_auth_middleware', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/test-admin-bad' });
    // Fastify default error handler returns 500 with { error, message } JSON
    assert.equal(res.statusCode, 500);
    const body = JSON.parse(res.body);
    assert.ok(
      String(body.message ?? '').includes('founder-admin-only requires auth.js as a prior preHandler hook'),
      `expected fail-loud guard message; got: ${res.body}`
    );
  });

  await t.test('encapsulation_does_not_leak_to_unrelated_routes', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/test-public' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body, { ok: true }, 'must not contain adminEmail — middleware should not bleed');
  });

  await t.test('invalid_cookie_signature_redirects_to_login', async () => {
    // Forge a bogus cookie value — no valid HMAC signature.
    const res = await fastify.inject({
      method: 'GET',
      url: '/test-admin',
      headers: { cookie: 'mp_session=garbage.signature' },
    });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, `/login?next=${encodeURIComponent('/test-admin')}`);
  });

  await t.test('valid_cookie_with_invalid_jwt_redirects_to_login', async () => {
    // Spec AC#7 fallback contract: the milder substitute for the brittle
    // "expired JWT" scenario must "exercise the same code path" as the JWT
    // failure branch — i.e. a cookie with a VALID signature wrapping a JSON
    // payload whose access_token is rejected by Supabase getUser(). Appending
    // junk to the signed cookie (the prior implementation) only exercises the
    // unsigned.valid===false branch, which is already covered by
    // invalid_cookie_signature_redirects_to_login. We re-sign a custom payload
    // here so unsignCookie() passes and getUser() is the failing step.
    const bogusPayload = JSON.stringify({
      access_token: 'not.a.valid.jwt',
      refresh_token: 'irrelevant-for-this-test',
    });
    const signed = fastify.signCookie(bogusPayload);
    const tampered = `mp_session=${signed}`;

    const res = await fastify.inject({
      method: 'GET',
      url: '/test-admin',
      headers: { cookie: tampered },
    });
    assert.equal(res.statusCode, 302, `expected 302 redirect; got ${res.statusCode}: ${res.body.slice(0, 200)}`);
    assert.equal(res.headers.location, `/login?next=${encodeURIComponent('/test-admin')}`);
  });

  await t.test('negative_assertion_no_admin_route_in_production_server', async () => {
    // Code-grep regression: production app/src/server.js must not register
    // any /admin route group. Story 1.5 ships primitives only — Story 8.10
    // owns the first /admin/* surface.
    const serverSource = await readFile(join(__dirname, '../../app/src/server.js'), 'utf8');
    const FORBIDDEN_PRODUCTION_PATTERNS = [
      "'/admin'",
      '"/admin"',
      'adminRoutes',
      'as_customer',
      'customer-impersonate',
      'login-as',
      'masquerade',
    ];
    const hits = FORBIDDEN_PRODUCTION_PATTERNS.filter((p) => serverSource.includes(p));
    assert.deepEqual(hits, [], `forbidden admin/impersonation patterns in app/src/server.js: ${hits.join(', ')}`);
  });

  await t.test('negative_assertion_no_role_field_on_request_user', async () => {
    // auth.js must not encode admin status as a JWT claim or user attribute.
    // Constraint #16 / FR2: admin authorization is binary and DB-driven via
    // founder_admins.email, not request.user.role / is_admin / etc.
    const authSource = await readFile(join(__dirname, '../../app/src/middleware/auth.js'), 'utf8');
    const FORBIDDEN_USER_FIELDS = ['is_admin', 'role', 'permissions', 'scopes'];
    const hits = FORBIDDEN_USER_FIELDS.filter((p) => authSource.includes(p));
    assert.deepEqual(hits, [], `forbidden role/permission fields in auth.js: ${hits.join(', ')}`);
  });
});
