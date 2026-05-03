// Story 2.1 / AC#4 — RLS-aware client + service-role client + tx helper tests.
//
// Covers:
//   AC#1 — getRlsAwareClient(jwt) scopes all queries to the JWT subject via RLS
//   AC#2 — getServiceRoleClient() bypasses RLS; instantiated ONLY in worker context
//   AC#3 — tx(client, cb) commits on success, rolls back on throw; savepoint behaviour
//   AC#4 — integration test confirming rls-aware rows never include customer-B data
//           when authenticated as customer A
//   AC#5 — ESLint rule fires when `pg` Pool is imported directly inside app/src/
//
// Topology constraints (AD2 / NFR-S3):
//   - RLS-aware client uses the JWT from Supabase Auth (user role)
//   - Service-role client uses SUPABASE_SERVICE_ROLE_DATABASE_URL (service_role role)
//   - The app process MUST NOT instantiate the service-role pool (grep assertion)
//   - The worker process MUST NOT expose getRlsAwareClient (grep assertion)
//
// Local-only: requires .env.test pointing at a local Supabase docker.
// Run with: node --env-file=.env.test --test tests/shared/db/clients.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getRlsAwareClient } from '../../../shared/db/rls-aware-client.js';
import { getServiceRoleClient, closeServiceRolePool } from '../../../shared/db/service-role-client.js';
import { tx, TransactionNestingError } from '../../../shared/db/tx.js';
import { resetAuthAndCustomers, endResetAuthPool } from '../../integration/_helpers/reset-auth-tables.js';

// ---------------------------------------------------------------------------
// Shared helper — sign up a test user and return their JWT access_token.
// Uses the Supabase JS client for signup/signin; forces email confirmation
// via the service-role pool so the test does not depend on email delivery.
// ---------------------------------------------------------------------------

/**
 * Creates a Supabase Auth user, forces email confirmation, signs in, and
 * returns the access_token and user id.
 *
 * @param {string} email - unique test email address
 * @param {string} password - password for the test account
 * @returns {Promise<{accessToken: string, userId: string}>}
 */
async function signupAndGetToken (email, password) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
  if (signUpError) throw new Error(`signUp failed for ${email}: ${signUpError.message}`);

  const userId = signUpData.user?.id;
  if (!userId) throw new Error(`signUp returned no user id for ${email}`);

  // Force email confirmation so /signInWithPassword succeeds on local Supabase
  const pool = getServiceRoleClient();
  await pool.query(
    'UPDATE auth.users SET email_confirmed_at = NOW() WHERE id = $1 AND email_confirmed_at IS NULL',
    [userId]
  );

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn failed for ${email}: ${signInError.message}`);

  const accessToken = signInData.session?.access_token;
  if (!accessToken) throw new Error(`signIn returned no access_token for ${email}`);

  return { accessToken, userId };
}

// ---------------------------------------------------------------------------
// Suite-level teardown — runs once after all tests complete.
// Registered at the top level (not inside a sub-test) so it fires regardless
// of individual test failures.
// ---------------------------------------------------------------------------

test('db-clients suite lifecycle', async (t) => {
  t.after(async () => {
    await resetAuthAndCustomers();
    await endResetAuthPool();
    await closeServiceRolePool();
  });

  // Reset auth tables before every test for isolation
  t.beforeEach(async () => {
    await resetAuthAndCustomers();
  });

  // ---------------------------------------------------------------------------
  // AC#1 — getRlsAwareClient scopes queries to the JWT subject
  // ---------------------------------------------------------------------------
  await t.test('rls_aware_client_scopes_to_jwt_subject', async () => {
    const emailA = `rls-a-${randomUUID()}@test.mp`;
    const emailB = `rls-b-${randomUUID()}@test.mp`;
    const pw = 'pa55word-strong-enough';

    const { accessToken: jwtA, userId: idA } = await signupAndGetToken(emailA, pw);
    // Customer B is seeded so RLS has two rows to filter from; JWT not needed here
    await signupAndGetToken(emailB, pw);

    // RLS-aware client for customer A must only see customer A's row
    const clientA = await getRlsAwareClient(jwtA);
    try {
      const { rows } = await clientA.query('SELECT id FROM customers');
      assert.equal(rows.length, 1, `RLS must return exactly 1 row for customer A; got ${rows.length}`);
      assert.equal(rows[0].id, idA, `RLS row id must equal customer A's id`);
    } finally {
      clientA.release();
    }
  });

  // ---------------------------------------------------------------------------
  // AC#2 — getServiceRoleClient bypasses RLS
  // ---------------------------------------------------------------------------
  await t.test('service_role_client_bypasses_rls', async () => {
    const emailA = `svc-a-${randomUUID()}@test.mp`;
    const emailB = `svc-b-${randomUUID()}@test.mp`;
    const pw = 'pa55word-strong-enough';

    await signupAndGetToken(emailA, pw);
    await signupAndGetToken(emailB, pw);

    const pool = getServiceRoleClient();

    // Service-role bypasses RLS — both rows must be visible
    const { rows } = await pool.query('SELECT id FROM customers ORDER BY created_at');
    assert.ok(rows.length >= 2, `service-role pool must see all customers; got ${rows.length}`);

    // Pool max config check (AC#2 — max: 5)
    assert.ok(
      pool.options.max <= 5,
      `service-role pool max must be <= 5; got ${pool.options.max}`
    );
  });

  // ---------------------------------------------------------------------------
  // AC#3 — tx helper commits on success
  // ---------------------------------------------------------------------------
  await t.test('tx_helper_commits_on_success', async () => {
    const pool = getServiceRoleClient();
    // worker_heartbeats is available as a scratch table from the Story 1.1 migration.
    // Insert a sentinel row inside the transaction; verify it survives COMMIT.
    const sentinelTs = new Date().toISOString();

    await tx(pool, async (txClient) => {
      await txClient.query(
        'INSERT INTO worker_heartbeats (last_seen_at) VALUES ($1)',
        [sentinelTs]
      );
    });

    const { rows } = await pool.query(
      'SELECT last_seen_at FROM worker_heartbeats WHERE last_seen_at = $1',
      [sentinelTs]
    );
    assert.equal(rows.length, 1, 'tx COMMIT — sentinel row must be visible after successful tx');

    // Cleanup: remove sentinel row (beforeEach only clears auth/customer tables)
    await pool.query('DELETE FROM worker_heartbeats WHERE last_seen_at = $1', [sentinelTs]);
  });

  // ---------------------------------------------------------------------------
  // AC#3 — tx helper rolls back on throw
  // ---------------------------------------------------------------------------
  await t.test('tx_helper_rolls_back_on_throw', async () => {
    const pool = getServiceRoleClient();
    // Use a timestamp slightly in the future to guarantee uniqueness across runs
    const sentinelTs = new Date(Date.now() + 5000).toISOString();

    await assert.rejects(
      async () => {
        await tx(pool, async (txClient) => {
          await txClient.query(
            'INSERT INTO worker_heartbeats (last_seen_at) VALUES ($1)',
            [sentinelTs]
          );
          throw new Error('intentional rollback');
        });
      },
      /intentional rollback/,
      'tx must re-throw the original error after issuing ROLLBACK'
    );

    // Row must NOT be visible after rollback
    const { rows } = await pool.query(
      'SELECT last_seen_at FROM worker_heartbeats WHERE last_seen_at = $1',
      [sentinelTs]
    );
    assert.equal(rows.length, 0, 'tx ROLLBACK — sentinel row must NOT be visible after tx throws');
  });

  // ---------------------------------------------------------------------------
  // AC#3 — tx helper nesting behaviour documented
  // Story 2.1 chooses Option A: reject nesting with TransactionNestingError.
  // The test asserts that calling tx(client, ...) when client is already inside
  // an active transaction throws TransactionNestingError.
  // This choice MUST match the @throws JSDoc in shared/db/tx.js.
  // ---------------------------------------------------------------------------
  await t.test('tx_helper_nesting_behaviour_documented', async () => {
    const pool = getServiceRoleClient();
    const client = await pool.connect();

    try {
      await assert.rejects(
        async () => {
          // Outer tx begins a transaction on `client`.
          // Inner tx() receives the same txClient — already inside BEGIN — and must reject.
          await tx(client, async (txClient) => {
            await tx(txClient, async (_inner) => {
              // This inner body must never execute
              assert.fail('inner tx callback must not execute when nesting is rejected');
            });
          });
        },
        (err) => {
          // Accept TransactionNestingError by class, name, or message pattern
          const isNestingError = (
            err instanceof TransactionNestingError ||
            err?.name === 'TransactionNestingError' ||
            /nested.*transaction|already.*transaction|ConcurrentTransaction/i.test(err?.message ?? '')
          );
          assert.ok(
            isNestingError,
            `expected TransactionNestingError on nested tx() call; got: ${err?.name} — ${err?.message}`
          );
          return true;
        },
        'tx() must throw TransactionNestingError when called with a client already inside a transaction'
      );
    } finally {
      // Ensure the client is returned to the pool even if the outer tx aborted
      client.release();
    }
  });

  // ---------------------------------------------------------------------------
  // AC#2 — service-role client advisory lock API (pg_try_advisory_lock)
  // ---------------------------------------------------------------------------
  await t.test('service_role_client_supports_advisory_locks', async () => {
    const pool = getServiceRoleClient();
    const lockId = 99999799; // arbitrary non-zero bigint-safe integer

    const { rows: lockRows } = await pool.query(
      'SELECT pg_try_advisory_lock($1::bigint) AS locked',
      [lockId]
    );
    assert.equal(lockRows[0].locked, true, 'pg_try_advisory_lock must return true (lock acquired)');

    // Always release to avoid lock leakage between tests
    await pool.query('SELECT pg_advisory_unlock($1::bigint)', [lockId]);
  });

  // ---------------------------------------------------------------------------
  // AC#1 (second clause) — rls-context middleware binds request.db
  // ---------------------------------------------------------------------------
  await t.test('rls_context_middleware_binds_request_db', async () => {
    // Dynamic import so this test file can be parsed before rls-context.js exists;
    // the test will fail at import time (not parse time) if the file is missing.
    const Fastify = (await import('fastify')).default;
    const FastifyCookie = (await import('@fastify/cookie')).default;
    const { rlsContext, releaseRlsClient } = await import('../../../app/src/middleware/rls-context.js');
    const { authMiddleware } = await import('../../../app/src/middleware/auth.js');

    const email = `rls-mw-${randomUUID()}@test.mp`;
    const pw = 'pa55word-strong-enough';
    const { accessToken: jwt } = await signupAndGetToken(email, pw);

    // Build a minimal Fastify instance: authMiddleware + rlsContext on /probe
    const fastify = Fastify({ logger: false });
    await fastify.register(FastifyCookie, {
      secret: process.env.COOKIE_SECRET,
      hook: 'onRequest',
    });

    await fastify.register(async (instance) => {
      instance.addHook('preHandler', authMiddleware);
      instance.addHook('preHandler', rlsContext);
      instance.addHook('onResponse', releaseRlsClient);
      instance.get('/probe', async (request) => ({
        hasDb: request.db != null,
        dbIsObject: typeof request.db === 'object',
      }));
    });

    await fastify.ready();

    try {
      // Sign the mp_session cookie exactly as login.js does (Story 1.4 contract)
      const sessionPayload = JSON.stringify({
        access_token: jwt,
        refresh_token: 'unused-for-this-test',
      });
      const signedCookie = fastify.signCookie(sessionPayload);

      const res = await fastify.inject({
        method: 'GET',
        url: '/probe',
        headers: { cookie: `mp_session=${signedCookie}` },
      });

      assert.equal(
        res.statusCode, 200,
        `GET /probe must return 200; got ${res.statusCode}: ${res.body.slice(0, 200)}`
      );
      const body = JSON.parse(res.body);
      assert.equal(body.hasDb, true, 'request.db must be bound by rlsContext middleware');
      assert.equal(body.dbIsObject, true, 'request.db must be an object (pg PoolClient)');
    } finally {
      await fastify.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Architectural-constraint negative assertions
  // (already fully implemented in the original scaffold — preserved verbatim)
  // ---------------------------------------------------------------------------

  await t.test('negative_assertion_service_role_client_not_importable_in_app_src', async () => {
    // Constraint: service-role pool instantiated only in worker.
    // Grep app/src/** for any import of service-role-client.js.
    // Permitted callers after Story 2.1 absorption:
    //   - app/src/routes/health.js (ops endpoint)
    //   - app/src/middleware/founder-admin-only.js (service-role lookup by design)
    // Customer-facing routes (_public, _authenticated) must never import it.
    // For simplicity this assertion checks ALL of app/src — the negative-assertion
    // for _authenticated/_public routes is the separate test below.
    const { readFile, readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');

    /** @param {string} dir @param {string[]} exts @returns {Promise<string[]>} */
    async function walk (dir, exts) {
      const out = [];
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...await walk(p, exts));
        else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
      }
      return out;
    }

    const files = await walk('app/src', ['.js']);
    const hits = [];
    for (const f of files) {
      const text = await readFile(f, 'utf8');
      if (text.includes('service-role-client')) hits.push(f);
    }
    assert.deepEqual(hits, [], `service-role-client must not be imported in app/src/: ${hits.join(', ')}`);
  });

  await t.test('negative_assertion_rls_aware_client_not_importable_in_worker', async () => {
    // Constraint (symmetric): getRlsAwareClient must not be imported in worker/src/.
    // Worker has no concept of user JWT — it operates as service_role only.
    const { readFile, readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');

    /** @param {string} dir @param {string[]} exts @returns {Promise<string[]>} */
    async function walk (dir, exts) {
      const out = [];
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...await walk(p, exts));
        else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
      }
      return out;
    }

    const files = await walk('worker/src', ['.js']);
    const hits = [];
    for (const f of files) {
      const text = await readFile(f, 'utf8');
      if (text.includes('rls-aware-client')) hits.push(f);
    }
    assert.deepEqual(hits, [], `rls-aware-client must not be imported in worker/src/: ${hits.join(', ')}`);
  });

  await t.test('negative_assertion_service_role_client_not_importable_in_app_src_authenticated_routes', async () => {
    // Tighter constraint: service-role client must NOT appear in _public or _authenticated
    // customer-facing route handlers. Permitted only in health.js and founder-admin-only.js.
    const { readFile, readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');

    /** @param {string} dir @param {string[]} exts @returns {Promise<string[]>} */
    async function walk (dir, exts) {
      const out = [];
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...await walk(p, exts));
        else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
      }
      return out;
    }

    const publicFiles = await walk('app/src/routes/_public', ['.js']);
    const authFiles = await walk('app/src/routes/_authenticated', ['.js']);

    const hits = [];
    for (const f of [...publicFiles, ...authFiles]) {
      const text = await readFile(f, 'utf8');
      if (text.includes('service-role-client')) hits.push(f);
    }
    assert.deepEqual(
      hits, [],
      `service-role-client must not be imported in _public or _authenticated route handlers: ${hits.join(', ')}`
    );
  });

  // ---------------------------------------------------------------------------
  // AC#1 (second clause) — rls-context middleware binds request.db
  // ---------------------------------------------------------------------------
  await t.test('rls_context_middleware_binds_request_db_without_auth_throws', async () => {
    // Fail-loud guard: rlsContext wired WITHOUT authMiddleware must throw
    // with the documented error message.
    const Fastify = (await import('fastify')).default;
    const FastifyCookie = (await import('@fastify/cookie')).default;
    const { rlsContext } = await import('../../../app/src/middleware/rls-context.js');

    const fastify = Fastify({ logger: false });
    await fastify.register(FastifyCookie, {
      secret: process.env.COOKIE_SECRET,
      hook: 'onRequest',
    });

    // Wire rlsContext WITHOUT authMiddleware — should fail-loud
    await fastify.register(async (instance) => {
      instance.addHook('preHandler', rlsContext);
      instance.get('/bad-probe', async () => ({ ok: true }));
    });

    await fastify.ready();

    try {
      const res = await fastify.inject({ method: 'GET', url: '/bad-probe' });
      // Fastify default error handler returns 500 when preHandler throws
      assert.equal(res.statusCode, 500, `expected 500 from fail-loud guard; got ${res.statusCode}`);
      const body = JSON.parse(res.body);
      assert.ok(
        String(body.message ?? '').includes('rls-context requires auth.js'),
        `expected fail-loud error message; got: ${res.body}`
      );
    } finally {
      await fastify.close();
    }
  });

  // ---------------------------------------------------------------------------
  // AC#5 — ESLint no-direct-pg-in-app rule fires on violation
  // ---------------------------------------------------------------------------
  await t.test('eslint_no_direct_pg_in_app_rule_fires_on_violation', async () => {
    // Verifies that the custom ESLint rule reports at least one error when given
    // a fixture string containing `import { Pool } from 'pg'` inside app/src/.
    // Uses ESLint's Linter class (flat config, programmatic API).
    const { Linter } = await import('eslint');
    const ruleModule = await import('../../../eslint-rules/no-direct-pg-in-app.js');

    const linter = new Linter({ configType: 'flat' });

    // Fixture: direct pg import inside app/src/ — the rule must flag this
    const fixtureCode = `import { Pool } from 'pg';
const pool = new Pool({ connectionString: 'postgres://localhost/test' });
export async function getPool () { return pool; }
`;

    const messages = linter.verify(
      fixtureCode,
      [
        {
          files: ['app/src/**/*.js'],
          plugins: { 'no-direct-pg': ruleModule.default },
          rules: { 'no-direct-pg/no-direct-pg-in-app': 'error' },
          languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        },
      ],
      { filename: 'app/src/routes/prices.js' }
    );

    assert.ok(
      messages.length >= 1,
      `ESLint rule 'no-direct-pg-in-app' must report at least 1 error on the fixture; got 0 messages — rule may not be implemented yet`
    );
    const ruleIds = messages.map((m) => m.ruleId);
    assert.ok(
      ruleIds.some((id) => id?.includes('no-direct-pg-in-app')),
      `Expected rule ID containing 'no-direct-pg-in-app' in messages; got: ${JSON.stringify(ruleIds)}`
    );
  });

  // ---------------------------------------------------------------------------
  await t.test('negative_assertion_no_direct_pg_pool_in_app_routes', async () => {
    // AC#5 (ESLint rule backup): app/src/routes and app/src/middleware must not
    // import pg Pool directly — they must use getRlsAwareClient factory.
    // This static grep complements the ESLint rule with a runtime-runnable assertion.
    const { readFile, readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');

    /** @param {string} dir @param {string[]} exts @returns {Promise<string[]>} */
    async function walk (dir, exts) {
      const out = [];
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) out.push(...await walk(p, exts));
        else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
      }
      return out;
    }

    const files = [
      ...await walk('app/src/routes', ['.js']),
      ...await walk('app/src/middleware', ['.js']),
    ];
    const hits = [];
    for (const f of files) {
      const text = await readFile(f, 'utf8');
      // Flag direct 'pg' import or new Pool() — allow import in shared/db/ only
      if (/import\s+(?:\{[^}]*Pool[^}]*\}|pg)\s+from\s+['"]pg['"]/.test(text)) {
        hits.push(f);
      }
    }
    assert.deepEqual(hits, [], `direct pg Pool import found in app/ layer (must use getRlsAwareClient): ${hits.join(', ')}`);
  });
});
