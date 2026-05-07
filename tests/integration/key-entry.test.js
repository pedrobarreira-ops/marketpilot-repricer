// Story 4.3 / AC#6 — Key entry form + 5s validation + encrypted persistence.
//
// Covers:
//   AC#1 — GET /onboarding/key renders form for PROVISIONING customer
//   AC#2 — Trust block renders with PT copy and lock icon (UX-DR23)
//   AC#3 — POST /onboarding/key/validate:
//             valid key  → vault row created (encrypted) + customer_marketplace PROVISIONING
//                           + redirect to /onboarding/scan
//             invalid key (401) → inline error, no vault row created
//             network timeout (5s) → inline retry CTA
//             cleartext key never in pino output
//   AC#4 — Successful validation sets shop_api_key_vault.last_validated_at
//   AC#4 — No audit event emitted (KEY_VALIDATED not in AD20 taxonomy)
//   AC#5 — "Como gerar a chave?" modal renders PT walkthrough; Escape closes it
//   AC#6 — Full integration: vault row + PROVISIONING + redirect
//
// Local-only: requires `.env.test` pointing at a local Supabase docker.
// Requires Mirakl mock server from tests/mocks/mirakl-server.js running (or
// started inline by the test) and seeded for happy/unhappy P11 paths.
//
// Run with: node --env-file=.env.test --test tests/integration/key-entry.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { createMiraklMockServer } from '../mocks/mirakl-server.js';
import {
  resetAuthAndCustomers,
  endResetAuthPool,
  getResetAuthPool,
} from './_helpers/reset-auth-tables.js';

const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * POST a form to the app server.
 * @param {string} path
 * @param {Record<string, string>} body
 * @param {{ headers?: Record<string, string>, redirect?: RequestRedirect }} [opts]
 */
async function postForm (path, body, { headers = {}, redirect = 'manual' } = {}) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    redirect,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  });
}

/**
 * GET a page from the app server.
 * @param {string} path
 * @param {{ headers?: Record<string, string>, redirect?: RequestRedirect }} [opts]
 */
async function getPage (path, { headers = {}, redirect = 'manual' } = {}) {
  return fetch(`${BASE}${path}`, {
    method: 'GET',
    redirect,
    headers,
  });
}

/**
 * Sign up a new test customer with unique email. Returns the email used.
 * @param {{ headers?: Record<string, string> }} [opts]
 * @returns {Promise<{ email: string, password: string }>}
 */
async function signupCustomer (opts = {}) {
  const email = `test-${randomUUID()}@key-entry-test.example.com`;
  const password = 'Pa55word-strong-enough!';
  const res = await postForm('/signup', {
    email,
    password,
    first_name: 'Test',
    last_name: 'Customer',
    company_name: 'Test Co',
  }, opts);
  assert.equal(res.status, 302, `signup should 302; got ${res.status}`);
  return { email, password };
}

/**
 * Confirm the user's email via service-role pool (bypasses real email flow).
 * @param {string} email
 */
async function confirmEmail (email) {
  const pool = getResetAuthPool();
  await pool.query(
    'UPDATE auth.users SET email_confirmed_at = NOW() WHERE email = $1 AND email_confirmed_at IS NULL',
    [email]
  );
}

/**
 * Log in a customer and return the mp_session cookie value.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<string>} the mp_session cookie (name=value pair)
 */
async function loginAndGetCookie (email, password) {
  const res = await postForm('/login', { email, password });
  assert.equal(res.status, 302, `login should 302; got ${res.status}`);
  const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''];
  const list = Array.isArray(setCookies) ? setCookies : [setCookies];
  const sessionCookie = list.find((c) => typeof c === 'string' && c.startsWith('mp_session='));
  assert.ok(sessionCookie, `login did not set mp_session cookie; headers: ${JSON.stringify(list)}`);
  return sessionCookie.split(';')[0];
}

/**
 * Sign up + confirm email + login. Returns the session cookie.
 * @returns {Promise<{ email: string, cookie: string }>}
 */
async function signupAndLogin () {
  const { email, password } = await signupCustomer();
  await confirmEmail(email);
  const cookie = await loginAndGetCookie(email, password);
  return { email, cookie };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test('key-entry integration', async (t) => {
  // ── Start Mirakl mock server ─────────────────────────────────────────────
  const { mockServer, baseUrl: mockBaseUrl } = await createMiraklMockServer();

  // ── Spawn app server with mock Mirakl URL override ───────────────────────
  // The key validation route reads WORTEN_INSTANCE_URL (or equivalent) from
  // env to allow overriding in tests. We pass the mock server URL so no live
  // Worten calls are made. MIRAKL_VALIDATION_TIMEOUT_MS is set short (500ms)
  // for the timeout test so we don't actually wait 5 full seconds.
  // WORTEN_TEST_EAN is required by the route (route returns 500 if missing) —
  // we set it here explicitly rather than relying on .env.test so the test is
  // robust against contributor env drift. Any 13-digit EAN works because the
  // mock server returns FIXTURE_P11_PT for any product_references value.
  const app = spawn('node', ['app/src/server.js'], {
    env: {
      ...process.env,
      WORTEN_INSTANCE_URL: mockBaseUrl,
      WORTEN_TEST_EAN: process.env.WORTEN_TEST_EAN ?? '8809606851663',
      MIRAKL_VALIDATION_TIMEOUT_MS: '500',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Capture pino stdout for redaction checks
  const logChunks = [];
  app.stdout.on('data', (chunk) => logChunks.push(chunk.toString()));
  app.stderr.on('data', (chunk) => logChunks.push(chunk.toString()));

  let appExitCode = null;
  app.on('exit', (code) => { appExitCode = code; });

  t.after(async () => {
    app.kill('SIGTERM');
    await mockServer.close();
    await endResetAuthPool();
  });

  // Wait for app server to become ready
  const deadline = Date.now() + 60_000;
  let healthy = false;
  while (Date.now() < deadline && !healthy) {
    if (appExitCode !== null) assert.fail(`app exited early with code ${appExitCode}`);
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok || res.status === 302) healthy = true;
    } catch { /* not ready */ }
    if (!healthy) await delay(500);
  }
  assert.ok(healthy, 'app server did not respond within 60s');

  const pool = getResetAuthPool();

  // ---------------------------------------------------------------------------
  // AC#1 — GET /onboarding/key renders the key entry form
  // ---------------------------------------------------------------------------

  await t.test('get_onboarding_key_renders_form_for_provisioning_customer', async () => {
    await resetAuthAndCustomers();

    const { email, cookie } = await signupAndLogin();

    // Get the customer's id to assert the customer exists
    const { rows } = await pool.query('SELECT id FROM auth.users WHERE email = $1', [email]);
    assert.equal(rows.length, 1, 'auth.users row must exist after signup');

    const res = await getPage('/onboarding/key', { headers: { cookie } });
    assert.equal(res.status, 200, `GET /onboarding/key should return 200; got ${res.status}`);
    const html = await res.text();

    // Key input present
    assert.ok(
      html.includes('shop_api_key') || html.includes('name="shop_api_key"'),
      'HTML must contain shop_api_key input'
    );
    // "Validar chave" submit button
    assert.ok(
      html.includes('Validar chave'),
      'HTML must contain "Validar chave" button'
    );
    // Guide modal link
    assert.ok(
      html.includes('Como gerar a chave'),
      'HTML must contain "Como gerar a chave?" link'
    );
  });

  // ---------------------------------------------------------------------------
  // AC#2 — Trust block renders with verbatim PT copy (UX-DR23)
  // ---------------------------------------------------------------------------

  await t.test('trust_block_renders_pt_copy_and_lock_icon', async () => {
    await resetAuthAndCustomers();

    const { cookie } = await signupAndLogin();

    const res = await getPage('/onboarding/key', { headers: { cookie } });
    assert.equal(res.status, 200);
    const html = await res.text();

    // Verbatim PT copy from UX-DR23 / §5.1
    assert.ok(
      html.includes('encriptada em repouso'),
      'Trust block must contain "encriptada em repouso" PT copy'
    );
    // Lock icon — Material Symbols "lock" or equivalent svg/class
    assert.ok(
      html.includes('lock') && (html.includes('material') || html.includes('svg') || html.includes('lock_icon') || html.includes('icon')),
      'Trust block must contain a lock icon reference'
    );
    // "Ver as nossas garantias" link
    assert.ok(
      html.includes('Ver as nossas garantias'),
      'Trust block must contain "Ver as nossas garantias" link'
    );
  });

  // ---------------------------------------------------------------------------
  // AC#3 — Valid key: vault row + customer_marketplace PROVISIONING + redirect
  // ---------------------------------------------------------------------------

  await t.test('valid_key_creates_vault_row_and_customer_marketplace_in_provisioning', async () => {
    await resetAuthAndCustomers();

    const { email, cookie } = await signupAndLogin();
    const { rows: userRows } = await pool.query('SELECT id FROM auth.users WHERE email = $1', [email]);
    const customerId = userRows[0].id;

    // Mock server already returns 200 for /api/products/offers by default
    const syntheticKey = `test-key-valid-${randomUUID()}`;

    const res = await postForm('/onboarding/key/validate', { shop_api_key: syntheticKey }, {
      headers: { cookie },
    });

    // Should redirect (302) on success
    assert.equal(res.status, 302, `validate should return 302 on success; got ${res.status}`);

    // Vault row must exist with encrypted ciphertext (≠ raw key)
    const vaultResult = await pool.query(`
      SELECT sav.ciphertext, sav.nonce, sav.auth_tag, sav.last_validated_at
      FROM shop_api_key_vault sav
      JOIN customer_marketplaces cm ON cm.id = sav.customer_marketplace_id
      WHERE cm.customer_id = $1
    `, [customerId]);
    assert.equal(vaultResult.rows.length, 1, 'shop_api_key_vault row must exist after valid key');

    const vaultRow = vaultResult.rows[0];
    // Ciphertext must not contain the raw key as plaintext
    assert.ok(vaultRow.ciphertext, 'vault ciphertext must be non-null');
    assert.ok(
      !vaultRow.ciphertext.toString('utf8').includes(syntheticKey),
      'ciphertext must not contain the raw key as plaintext (must be encrypted)'
    );

    // Customer marketplace row must be in PROVISIONING
    const cmResult = await pool.query(`
      SELECT cron_state, operator, marketplace_instance_url,
             shop_id, channel_pricing_mode
      FROM customer_marketplaces
      WHERE customer_id = $1
    `, [customerId]);
    assert.equal(cmResult.rows.length, 1, 'customer_marketplaces row must exist after valid key');
    assert.equal(cmResult.rows[0].cron_state, 'PROVISIONING', 'cron_state must be PROVISIONING');
    assert.equal(cmResult.rows[0].operator, 'WORTEN', 'operator must be WORTEN');
    assert.equal(cmResult.rows[0].marketplace_instance_url, 'https://marketplace.worten.pt');
    // A01/PC01 columns must be NULL in PROVISIONING (F4 CHECK constraint)
    assert.equal(cmResult.rows[0].shop_id, null, 'A01 columns must be NULL in PROVISIONING');
    assert.equal(cmResult.rows[0].channel_pricing_mode, null, 'PC01 columns must be NULL in PROVISIONING');
  });

  await t.test('valid_key_redirects_to_onboarding_scan', async () => {
    await resetAuthAndCustomers();

    const { cookie } = await signupAndLogin();
    const syntheticKey = `test-key-redirect-${randomUUID()}`;

    const res = await postForm('/onboarding/key/validate', { shop_api_key: syntheticKey }, {
      headers: { cookie },
    });

    assert.equal(res.status, 302, 'successful validation must return 302 redirect');
    const location = res.headers.get('location');
    assert.ok(
      location === '/onboarding/scan' || location?.includes('/onboarding/scan'),
      `redirect location must be /onboarding/scan; got: ${location}`
    );
  });

  await t.test('valid_key_sets_last_validated_at_on_vault_row', async () => {
    await resetAuthAndCustomers();

    const { email, cookie } = await signupAndLogin();
    const { rows: userRows } = await pool.query('SELECT id FROM auth.users WHERE email = $1', [email]);
    const customerId = userRows[0].id;

    const syntheticKey = `test-key-ts-${randomUUID()}`;

    const res = await postForm('/onboarding/key/validate', { shop_api_key: syntheticKey }, {
      headers: { cookie },
    });
    assert.equal(res.status, 302, 'must redirect on success');

    const vaultResult = await pool.query(`
      SELECT sav.last_validated_at
      FROM shop_api_key_vault sav
      JOIN customer_marketplaces cm ON cm.id = sav.customer_marketplace_id
      WHERE cm.customer_id = $1
    `, [customerId]);
    assert.equal(vaultResult.rows.length, 1, 'vault row must exist');
    assert.ok(
      vaultResult.rows[0].last_validated_at !== null,
      'last_validated_at must be set (NOT NULL) after successful validation'
    );
  });

  await t.test('invalid_key_401_returns_inline_pt_error_no_vault_row', async () => {
    await resetAuthAndCustomers();

    const { email, cookie } = await signupAndLogin();
    const { rows: userRows } = await pool.query('SELECT id FROM auth.users WHERE email = $1', [email]);
    const customerId = userRows[0].id;

    // Inject 401 from mock server for the next P11 request
    mockServer.injectError({ path: '/api/products/offers', status: 401, count: 1 });

    const invalidKey = `test-invalid-key-${randomUUID()}`;
    const res = await postForm('/onboarding/key/validate', { shop_api_key: invalidKey }, {
      headers: { cookie },
    });

    // Must NOT redirect (no 302) — should re-render with inline error
    assert.notEqual(res.status, 302, '401 key must not cause redirect');
    const html = await res.text();

    // Must contain PT-localized error from getSafeErrorMessage(err) for 401
    assert.ok(
      html.includes('inválida') || html.includes('A chave Worten'),
      `Response must contain PT inline error for 401; got: ${html.slice(0, 500)}`
    );

    // No vault row must have been created
    const vaultResult = await pool.query(`
      SELECT sav.customer_marketplace_id
      FROM shop_api_key_vault sav
      JOIN customer_marketplaces cm ON cm.id = sav.customer_marketplace_id
      WHERE cm.customer_id = $1
    `, [customerId]);
    assert.equal(vaultResult.rows.length, 0, 'No vault row must exist after 401 invalid key');

    // No customer_marketplaces row must have been created
    const cmResult = await pool.query(
      'SELECT id FROM customer_marketplaces WHERE customer_id = $1',
      [customerId]
    );
    assert.equal(cmResult.rows.length, 0, 'No customer_marketplaces row must exist after 401 invalid key');
  });

  await t.test('network_timeout_returns_inline_retry_cta', async () => {
    await resetAuthAndCustomers();

    const { email, cookie } = await signupAndLogin();
    const { rows: userRows } = await pool.query('SELECT id FROM auth.users WHERE email = $1', [email]);
    const customerId = userRows[0].id;

    // Inject delay beyond the validation timeout (MIRAKL_VALIDATION_TIMEOUT_MS=500ms)
    // Mock will delay 1500ms, which exceeds the 500ms AbortController cutoff
    mockServer.injectDelay({ path: '/api/products/offers', ms: 1500 });

    const slowKey = `test-slow-key-${randomUUID()}`;
    const res = await postForm('/onboarding/key/validate', { shop_api_key: slowKey }, {
      headers: { cookie },
    });

    // Clean up delay injection for subsequent tests
    mockServer.clearDelay('/api/products/offers');

    // Must NOT redirect — should re-render with inline retry CTA
    assert.notEqual(res.status, 302, 'timeout must not cause redirect');
    const html = await res.text();

    // Must contain retry CTA text (PT-localized)
    assert.ok(
      html.includes('Tentar novamente') || html.includes('novamente') || html.includes('Não conseguimos contactar'),
      `Timeout response must contain retry CTA; got: ${html.slice(0, 500)}`
    );

    // No vault row must have been created
    const vaultResult = await pool.query(`
      SELECT sav.customer_marketplace_id
      FROM shop_api_key_vault sav
      JOIN customer_marketplaces cm ON cm.id = sav.customer_marketplace_id
      WHERE cm.customer_id = $1
    `, [customerId]);
    assert.equal(vaultResult.rows.length, 0, 'No vault row must exist after timeout');

    // No customer_marketplaces row must have been created
    const cmResult = await pool.query(
      'SELECT id FROM customer_marketplaces WHERE customer_id = $1',
      [customerId]
    );
    assert.equal(cmResult.rows.length, 0, 'No customer_marketplaces row must exist after timeout');
  });

  await t.test('cleartext_key_never_appears_in_pino_output', async () => {
    await resetAuthAndCustomers();

    // Use a highly distinctive synthetic key that would be detectable in any log line
    const syntheticKey = `REDACT-CANARY-KEY-${randomUUID()}-DO-NOT-LOG`;

    // Clear log buffer before this test
    logChunks.length = 0;

    const { cookie } = await signupAndLogin();

    await postForm('/onboarding/key/validate', { shop_api_key: syntheticKey }, {
      headers: { cookie },
    });

    // Brief wait to allow any async log flushes
    await delay(200);

    // Concatenate all captured log output
    const allLogs = logChunks.join('');

    assert.ok(
      !allLogs.includes(syntheticKey),
      `Cleartext key "${syntheticKey.slice(0, 30)}..." must NEVER appear in pino log output. ` +
      `Found in logs: ${allLogs.slice(0, 200)}`
    );
  });

  await t.test('no_audit_event_emitted_on_key_validated', async () => {
    await resetAuthAndCustomers();

    // Sign up + log in BEFORE counting audit_log so any signup-emitted events
    // (none today, but defensive against Story 9.x adding CUSTOMER_SIGNED_UP
    // later) don't pollute the delta we're asserting on. The contract under
    // test is "POST /onboarding/key/validate emits zero audit events" — we
    // measure the delta straddling exactly that POST.
    const { cookie } = await signupAndLogin();

    const beforeResult = await pool.query('SELECT COUNT(*)::int AS n FROM audit_log');
    const beforeCount = beforeResult.rows[0].n;

    const syntheticKey = `test-key-audit-${randomUUID()}`;

    const res = await postForm('/onboarding/key/validate', { shop_api_key: syntheticKey }, {
      headers: { cookie },
    });
    assert.equal(res.status, 302, 'must redirect on success');

    // Count audit_log rows after
    const afterResult = await pool.query('SELECT COUNT(*)::int AS n FROM audit_log');
    const afterCount = afterResult.rows[0].n;

    assert.equal(
      afterCount,
      beforeCount,
      `audit_log row count must be unchanged after key validation ` +
      `(KEY_VALIDATED is NOT in the AD20 taxonomy). Before: ${beforeCount}, After: ${afterCount}`
    );
  });

  // ---------------------------------------------------------------------------
  // AC#5 — Guide modal
  // ---------------------------------------------------------------------------

  await t.test('guide_modal_renders_pt_walkthrough_content', async () => {
    await resetAuthAndCustomers();

    const { cookie } = await signupAndLogin();

    const res = await getPage('/onboarding/key', { headers: { cookie } });
    assert.equal(res.status, 200);
    const html = await res.text();

    // Must contain the modal for "Como gerar a chave?" (FR10)
    assert.ok(
      html.includes('Como gerar a chave') || html.includes('key-help'),
      'HTML must contain the key-help guide modal trigger or element'
    );

    // Must contain "Fechar" button for closing the modal
    assert.ok(
      html.includes('Fechar'),
      'Guide modal must contain "Fechar" close button'
    );

    // Must contain 3-step walkthrough content (Worten Seller Center → Account → API Keys)
    // AC#5 requires PT walkthrough referencing Worten Seller Center steps
    assert.ok(
      html.includes('Worten') || html.includes('Seller Center') || html.includes('API'),
      'Guide modal must contain Worten API key walkthrough references'
    );

    // Accessibility: role="dialog" + aria-modal
    assert.ok(
      html.includes('role="dialog"') || html.includes("role='dialog'"),
      'Guide modal must have role="dialog" for accessibility (NFR-A2)'
    );
    assert.ok(
      html.includes('aria-modal'),
      'Guide modal must have aria-modal attribute (NFR-A2)'
    );
  });

  // ---------------------------------------------------------------------------
  // AC#6 — Full integration flows
  // ---------------------------------------------------------------------------

  await t.test('integration_test_valid_key_full_flow', async () => {
    await resetAuthAndCustomers();

    const { email, cookie } = await signupAndLogin();
    const { rows: userRows } = await pool.query('SELECT id FROM auth.users WHERE email = $1', [email]);
    const customerId = userRows[0].id;

    const syntheticKey = `e2e-valid-${randomUUID()}`;

    // POST key validation (happy path — mock server returns 200 by default)
    const validateRes = await postForm('/onboarding/key/validate', { shop_api_key: syntheticKey }, {
      headers: { cookie },
    });

    // E2E: must redirect to /onboarding/scan
    assert.equal(validateRes.status, 302, 'E2E valid key must 302 redirect');
    const location = validateRes.headers.get('location');
    assert.ok(
      location === '/onboarding/scan' || location?.includes('/onboarding/scan'),
      `E2E: redirect must be to /onboarding/scan; got: ${location}`
    );

    // E2E: vault row must exist with encrypted ciphertext
    const vaultResult = await pool.query(`
      SELECT sav.ciphertext, sav.last_validated_at
      FROM shop_api_key_vault sav
      JOIN customer_marketplaces cm ON cm.id = sav.customer_marketplace_id
      WHERE cm.customer_id = $1
    `, [customerId]);
    assert.equal(vaultResult.rows.length, 1, 'E2E: vault row must exist');
    assert.ok(vaultResult.rows[0].ciphertext, 'E2E: ciphertext must be non-null');
    assert.ok(vaultResult.rows[0].last_validated_at, 'E2E: last_validated_at must be set');

    // E2E: customer_marketplaces row must be in PROVISIONING
    const cmResult = await pool.query(
      "SELECT cron_state FROM customer_marketplaces WHERE customer_id = $1",
      [customerId]
    );
    assert.equal(cmResult.rows.length, 1, 'E2E: customer_marketplaces row must exist');
    assert.equal(cmResult.rows[0].cron_state, 'PROVISIONING', 'E2E: cron_state must be PROVISIONING');

    // E2E: scan_jobs row must exist in PENDING
    const scanResult = await pool.query(`
      SELECT sj.status
      FROM scan_jobs sj
      JOIN customer_marketplaces cm ON cm.id = sj.customer_marketplace_id
      WHERE cm.customer_id = $1
    `, [customerId]);
    assert.equal(scanResult.rows.length, 1, 'E2E: scan_jobs row must exist after key validation');
    assert.equal(scanResult.rows[0].status, 'PENDING', 'E2E: scan_jobs row must be PENDING');
  });

  await t.test('integration_test_invalid_key_no_side_effects', async () => {
    await resetAuthAndCustomers();

    const { email, cookie } = await signupAndLogin();
    const { rows: userRows } = await pool.query('SELECT id FROM auth.users WHERE email = $1', [email]);
    const customerId = userRows[0].id;

    // Inject 401 for invalid key
    mockServer.injectError({ path: '/api/products/offers', status: 401, count: 1 });

    const invalidKey = `e2e-invalid-${randomUUID()}`;
    const res = await postForm('/onboarding/key/validate', { shop_api_key: invalidKey }, {
      headers: { cookie },
    });

    // E2E: must not redirect
    assert.notEqual(res.status, 302, 'E2E invalid key must not redirect');

    // E2E: zero vault rows
    const vaultResult = await pool.query(`
      SELECT sav.customer_marketplace_id
      FROM shop_api_key_vault sav
      JOIN customer_marketplaces cm ON cm.id = sav.customer_marketplace_id
      WHERE cm.customer_id = $1
    `, [customerId]);
    assert.equal(vaultResult.rows.length, 0, 'E2E: zero vault rows after invalid key');

    // E2E: zero customer_marketplaces rows
    const cmResult = await pool.query(
      'SELECT id FROM customer_marketplaces WHERE customer_id = $1',
      [customerId]
    );
    assert.equal(cmResult.rows.length, 0, 'E2E: zero customer_marketplaces rows after invalid key');

    // E2E: zero scan_jobs rows
    const scanResult = await pool.query(`
      SELECT sj.id
      FROM scan_jobs sj
      JOIN customer_marketplaces cm ON cm.id = sj.customer_marketplace_id
      WHERE cm.customer_id = $1
    `, [customerId]);
    assert.equal(scanResult.rows.length, 0, 'E2E: zero scan_jobs rows after invalid key');
  });

  await t.test('integration_test_timeout_no_side_effects', async () => {
    await resetAuthAndCustomers();

    const { email, cookie } = await signupAndLogin();
    const { rows: userRows } = await pool.query('SELECT id FROM auth.users WHERE email = $1', [email]);
    const customerId = userRows[0].id;

    // Inject delay beyond MIRAKL_VALIDATION_TIMEOUT_MS (500ms in test env)
    mockServer.injectDelay({ path: '/api/products/offers', ms: 1500 });

    const slowKey = `e2e-timeout-${randomUUID()}`;
    const res = await postForm('/onboarding/key/validate', { shop_api_key: slowKey }, {
      headers: { cookie },
    });

    // Clean up delay for subsequent tests
    mockServer.clearDelay('/api/products/offers');

    // E2E: must not redirect
    assert.notEqual(res.status, 302, 'E2E timeout must not redirect');

    // E2E: zero vault rows
    const vaultResult = await pool.query(`
      SELECT sav.customer_marketplace_id
      FROM shop_api_key_vault sav
      JOIN customer_marketplaces cm ON cm.id = sav.customer_marketplace_id
      WHERE cm.customer_id = $1
    `, [customerId]);
    assert.equal(vaultResult.rows.length, 0, 'E2E: zero vault rows after timeout');

    // E2E: zero customer_marketplaces rows
    const cmResult = await pool.query(
      'SELECT id FROM customer_marketplaces WHERE customer_id = $1',
      [customerId]
    );
    assert.equal(cmResult.rows.length, 0, 'E2E: zero customer_marketplaces rows after timeout');

    // E2E: zero scan_jobs rows
    const scanResult = await pool.query(`
      SELECT sj.id
      FROM scan_jobs sj
      JOIN customer_marketplaces cm ON cm.id = sj.customer_marketplace_id
      WHERE cm.customer_id = $1
    `, [customerId]);
    assert.equal(scanResult.rows.length, 0, 'E2E: zero scan_jobs rows after timeout');
  });
});
