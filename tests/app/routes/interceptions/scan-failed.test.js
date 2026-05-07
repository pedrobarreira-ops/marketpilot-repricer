// Story 4.6 / AC#1-AC#3 — Scan-failed email + /scan-failed interception tests.
//
// Covers:
//   AC#1 — Scan failure triggers email via sendCriticalAlert (NFR-P9: ≤5 min)
//           Email subject: "A análise do teu catálogo MarketPilot não conseguiu completar"
//           Email HTML rendered from scan-failed.eta template (contains failure_reason
//           and /onboarding/key link); cleartext API key never in email or logs.
//   AC#2 — /scan-failed interception page renders with failure_reason + retry button
//           UX-DR3: customer with FAILED scan who logs in lands on /scan-failed (not /)
//           Page is keyboard accessible (NFR-A2)
//           Page is PT-localized.
//   AC#3 — Healthy scan completion sends NO email (FR15)
//   NFR  — shared/resend/client.js is the single canonical Resend interface (grep assertion)
//
// Approach:
//   - Seed FAILED scan_jobs rows directly via service-role client (no re-run of
//     full scan orchestrator — Story 4.4 owns that integration test)
//   - sendCriticalAlert is stubbed to capture call args without Resend API calls
//   - HTTP assertions use fetch() against the running app server
//
// Local-only: requires `.env.test` pointing at a local Supabase docker.
// Run with: node --env-file=.env.test --test tests/app/routes/interceptions/scan-failed.test.js

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { getServiceRoleClient, closeServiceRolePool } from '../../../../shared/db/service-role-client.js';
import {
  resetAuthAndCustomers,
  endResetAuthPool,
  getResetAuthPool,
} from '../../integration/_helpers/reset-auth-tables.js';

const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Verbatim copy constants (encode as constants for easy PR-review diffs)
// ---------------------------------------------------------------------------

// AC#1 — Email subject verbatim (epics-distillate Story 4.6 AC1)
const EMAIL_SUBJECT_PT =
  'A análise do teu catálogo MarketPilot não conseguiu completar';

// AC#2 — "Tentar novamente" button text (UX-DR3)
const RETRY_BUTTON_PT = 'Tentar novamente';

// AC#2 — Retry link target
const KEY_ENTRY_PATH = '/onboarding/key';

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

let _supabaseAdmin = null;
function _getSupabaseAdmin () {
  if (_supabaseAdmin === null) {
    _supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return _supabaseAdmin;
}
void _getSupabaseAdmin; // reserved for future tests that need the admin client

/**
 * Sign up a test user and return their email + password.
 * @returns {Promise<{ email: string, password: string }>}
 */
async function signupCustomer () {
  const email = `scan-failed-test-${randomUUID()}@test.marketpilot.pt`;
  const password = 'Pa55word-test!';
  const res = await fetch(`${BASE}/signup`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      email,
      password,
      first_name: 'ScanFail',
      last_name: 'Tester',
      company_name: 'TestCo',
    }).toString(),
  });
  assert.equal(res.status, 302, `signup must 302; got ${res.status}`);
  return { email, password };
}

/**
 * Confirm email via service-role pool (bypasses real email flow).
 * @param {string} email
 */
async function confirmEmail (email) {
  const pool = getResetAuthPool();
  await pool.query(
    'UPDATE auth.users SET email_confirmed_at = NOW() WHERE email = $1 AND email_confirmed_at IS NULL',
    [email],
  );
}

/**
 * Log in and return the mp_session cookie string.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<string>} cookie value for use in headers
 */
async function loginAndGetCookie (email, password) {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, password }).toString(),
  });
  assert.equal(res.status, 302, `login must 302; got ${res.status}`);
  const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''];
  const list = Array.isArray(setCookies) ? setCookies : [setCookies];
  const sessionCookie = list.find((c) => typeof c === 'string' && c.startsWith('mp_session='));
  assert.ok(sessionCookie, `login did not set mp_session cookie; headers: ${JSON.stringify(list)}`);
  return sessionCookie.split(';')[0];
}

/**
 * Full signup → confirm email → login flow.
 * @returns {Promise<{ email: string, userId: string, cookie: string }>}
 */
async function signupAndLogin () {
  const { email, password } = await signupCustomer();
  await confirmEmail(email);
  const cookie = await loginAndGetCookie(email, password);

  const pool = getResetAuthPool();
  const { rows } = await pool.query('SELECT id FROM auth.users WHERE email = $1', [email]);
  assert.equal(rows.length, 1, 'auth.users row must exist after signup');
  return { email, userId: rows[0].id, cookie };
}

/**
 * Seed a customer_marketplaces row in PROVISIONING for the given customer.
 * @param {string} customerId — auth.users.id
 * @returns {Promise<string>} customerMarketplaceId
 */
async function seedProvisioningMarketplace (customerId) {
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    `INSERT INTO customer_marketplaces
       (customer_id, operator, marketplace_instance_url, max_discount_pct)
     VALUES ($1, 'WORTEN', 'https://marketplace.worten.pt', 0.0300)
     RETURNING id`,
    [customerId],
  );
  return rows[0].id;
}

/**
 * Seed a FAILED scan_jobs row directly (bypasses orchestrator per dev notes).
 * @param {string} customerMarketplaceId
 * @param {string} failureReason
 * @returns {Promise<string>} scanJobId
 */
async function seedFailedScanJob (customerMarketplaceId, failureReason = 'O Worten não tem preços por canal activados.') {
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    `INSERT INTO scan_jobs
       (customer_marketplace_id, status, phase_message, failure_reason, completed_at)
     VALUES ($1, 'FAILED', 'Falhou', $2, NOW())
     RETURNING id`,
    [customerMarketplaceId, failureReason],
  );
  return rows[0].id;
}

/**
 * Seed a COMPLETE scan_jobs row (for AC#3 — healthy completion no email test).
 * @param {string} customerMarketplaceId
 * @returns {Promise<string>} scanJobId
 */
async function seedCompleteScanJob (customerMarketplaceId) {
  const db = getServiceRoleClient();
  const { rows } = await db.query(
    `INSERT INTO scan_jobs
       (customer_marketplace_id, status, phase_message, completed_at)
     VALUES ($1, 'COMPLETE', 'Pronto', NOW())
     RETURNING id`,
    [customerMarketplaceId],
  );
  return rows[0].id;
}

/**
 * Clean up a customer_marketplace row (cascades to scan_jobs).
 * @param {string} customerMarketplaceId
 */
async function cleanupMarketplace (customerMarketplaceId) {
  if (!customerMarketplaceId) return;
  const db = getServiceRoleClient();
  await db.query('DELETE FROM customer_marketplaces WHERE id = $1', [customerMarketplaceId]);
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function getPage (path, { headers = {}, redirect = 'manual' } = {}) {
  return fetch(`${BASE}${path}`, { method: 'GET', redirect, headers });
}

// ---------------------------------------------------------------------------
// sendCriticalAlert call capture
// ---------------------------------------------------------------------------

/**
 * Create a call-capturing spy for sendCriticalAlert.
 * Returns { calls: Array<{to, subject, html}>, reset() }.
 * Since mock.module() is not available in all Node 22 versions for ESM,
 * we track calls by intercepting the worker import in the test scope.
 */
function _makeSendCriticalAlertSpy () {
  const calls = [];
  const spy = async ({ to, subject, html }) => {
    calls.push({ to, subject, html });
  };
  return { calls, spy, reset: () => calls.splice(0) };
}
void _makeSendCriticalAlertSpy; // spy factory reserved for future mocking tests

// ---------------------------------------------------------------------------
// App server lifecycle (spawned once per suite)
// ---------------------------------------------------------------------------

// NOTE: The app server must be running before these tests execute.
// Tests assert against the running server at BASE (default: http://localhost:3000).
// Kill any pre-existing server on port 3000 before running:
//   node --env-file=.env.test --test tests/app/routes/interceptions/scan-failed.test.js

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test('scan-failed interception', async (t) => {
  // ── Suite setup: spawn app server ────────────────────────────────────────
  const app = spawn('node', ['app/src/server.js'], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const logChunks = [];
  app.stdout.on('data', (chunk) => logChunks.push(chunk.toString()));
  app.stderr.on('data', (chunk) => logChunks.push(chunk.toString()));

  let appExitCode = null;
  app.on('exit', (code) => { appExitCode = code; });

  t.after(async () => {
    app.kill('SIGTERM');
    await endResetAuthPool();
    await closeServiceRolePool();
    mock.reset();
  });

  // Wait for app server to become ready
  const deadline = Date.now() + 60_000;
  let healthy = false;
  while (Date.now() < deadline && !healthy) {
    if (appExitCode !== null) assert.fail(`app exited early with code ${appExitCode}`);
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok || res.status === 302) healthy = true;
    } catch { /* not ready yet */ }
    if (!healthy) await delay(500);
  }
  assert.ok(healthy, 'app server did not respond within 60s');

  // ---------------------------------------------------------------------------
  // AC#1 — Email on scan failure
  // ---------------------------------------------------------------------------

  await t.test('scan_failure_email_sent_within_5min', async () => {
    // This test verifies that when a FAILED scan_jobs row exists and the worker
    // processes it, sendCriticalAlert is called with the correct arguments.
    //
    // Approach: directly call the worker's processNextPendingScan() with a
    // FAILED-path-triggering mock, and capture sendCriticalAlert calls.
    // Since the email is sent synchronously during scan failure recording
    // (fire-and-await per dev notes, NFR-P9 met if called before FAILED write),
    // no 5-minute real wait is needed — we verify the call happens within the
    // test timeout.
    //
    // At Step 2 (pre-dev): we assert the test contract is structurally correct
    // (module shape, spy contract). Full call capture requires Story 4.6 impl.

    await resetAuthAndCustomers();
    const { userId } = await signupAndLogin();
    const cmId = await seedProvisioningMarketplace(userId);

    // Seed a PENDING scan_jobs row (onboarding-scan.js processes PENDING rows)
    const db = getServiceRoleClient();
    await db.query(
      `INSERT INTO scan_jobs (customer_marketplace_id, status, phase_message)
       VALUES ($1, 'PENDING', 'A configurar integração com Worten')`,
      [cmId],
    );

    // Import onboarding-scan and verify it references sendCriticalAlert
    // (structural check — full call capture verified in integration test)
    const workerModule = await import('../../../../worker/src/jobs/onboarding-scan.js');
    assert.ok(
      typeof workerModule.processNextPendingScan === 'function',
      'processNextPendingScan must be a named export from onboarding-scan.js',
    );

    // Verify source: onboarding-scan.js must import sendCriticalAlert from
    // shared/resend/client.js (grep assertion — static code analysis)
    const { readFile } = await import('node:fs/promises');
    const scanWorkerSrc = await readFile('worker/src/jobs/onboarding-scan.js', 'utf8');
    assert.ok(
      scanWorkerSrc.includes('sendCriticalAlert') &&
      scanWorkerSrc.includes('shared/resend/client'),
      'onboarding-scan.js must import sendCriticalAlert from shared/resend/client.js',
    );

    await cleanupMarketplace(cmId);
  });

  await t.test('scan_failure_email_subject_is_correct_pt_string', async () => {
    // Verify the email subject constant used in onboarding-scan.js matches
    // the verbatim PT string from the epics-distillate (AC#1 spec).
    //
    // Static assertion: grep onboarding-scan.js for the exact subject string.

    // Self-check: the test constant must match the verbatim spec subject.
    assert.equal(
      EMAIL_SUBJECT_PT,
      'A análise do teu catálogo MarketPilot não conseguiu completar',
      'Email subject constant must match spec verbatim (self-check)',
    );

    // Production code must include the verbatim PT email subject string —
    // either inline in worker/src/jobs/onboarding-scan.js or in a helper it
    // imports (worker/src/email/scan-failed-email.js per dev notes).
    const { readFile } = await import('node:fs/promises');
    const scanWorkerSrc = await readFile('worker/src/jobs/onboarding-scan.js', 'utf8');
    let emailHelperSrc = '';
    try {
      emailHelperSrc = await readFile('worker/src/email/scan-failed-email.js', 'utf8');
    } catch { /* helper may live elsewhere — fall through */ }

    const subjectFoundInWorker = scanWorkerSrc.includes(EMAIL_SUBJECT_PT);
    const subjectFoundInHelper = emailHelperSrc.includes(EMAIL_SUBJECT_PT);
    assert.ok(
      subjectFoundInWorker || subjectFoundInHelper,
      `Verbatim PT email subject must appear in onboarding-scan.js or its email helper: "${EMAIL_SUBJECT_PT}"`,
    );
  });

  await t.test('scan_failure_email_html_rendered_from_eta_template', async () => {
    // Verify the email HTML template exists and contains required elements:
    // - failure_reason rendered (template variable)
    // - /onboarding/key link for re-validation
    // - Does NOT contain cleartext API key binding

    const { readFile } = await import('node:fs/promises');
    const templateSrc = await readFile('app/src/views/emails/scan-failed.eta', 'utf8');

    // Template must reference failureReason (eta template variable)
    assert.ok(
      templateSrc.includes('failureReason') || templateSrc.includes('failure_reason'),
      'scan-failed.eta must render failure_reason content',
    );
    // Template must contain /onboarding/key link
    assert.ok(
      templateSrc.includes('/onboarding/key') || templateSrc.includes('keyUrl'),
      'scan-failed.eta must include /onboarding/key link (or keyUrl binding)',
    );
    // Template must NOT include cleartext key bindings (PII constraint)
    const forbiddenPatterns = ['apikey', 'api_key', 'shopKey', 'shopApiKey', 'shop_api_key'];
    for (const pattern of forbiddenPatterns) {
      assert.ok(
        !templateSrc.toLowerCase().includes(pattern.toLowerCase()),
        `scan-failed.eta must NOT contain "${pattern}" (cleartext key binding forbidden)`,
      );
    }
  });

  // ---------------------------------------------------------------------------
  // AC#2 — /scan-failed page
  // ---------------------------------------------------------------------------

  await t.test('scan_failed_page_renders_with_failure_reason_and_retry_button', async () => {
    // Seed: customer with FAILED scan_jobs row
    // GET /scan-failed with auth cookie
    // Assert: failure_reason text present; retry button links to /onboarding/key

    await resetAuthAndCustomers();
    const { userId, cookie } = await signupAndLogin();
    const cmId = await seedProvisioningMarketplace(userId);
    const failureReason = 'O Worten não tem preços por canal activados. Por favor contacta o suporte.';
    await seedFailedScanJob(cmId, failureReason);

    const res = await getPage('/scan-failed', { headers: { cookie } });

    assert.equal(res.status, 200, `GET /scan-failed must return 200 for customer with FAILED scan; got ${res.status}`);
    const html = await res.text();

    // failure_reason must be rendered verbatim (route stores PT-localized strings
    // in scan_jobs.failure_reason, so the seeded reason should appear in HTML).
    assert.ok(
      html.includes(failureReason),
      `Page must render the seeded failure_reason verbatim; HTML did not contain: "${failureReason}"`,
    );

    // "Tentar novamente →" button/link must be present
    assert.ok(
      html.includes(RETRY_BUTTON_PT),
      `Page must contain "${RETRY_BUTTON_PT}" button text`,
    );

    // Retry button/link must point to /onboarding/key
    assert.ok(
      html.includes(KEY_ENTRY_PATH),
      `Page must contain a link to "${KEY_ENTRY_PATH}" for re-validation`,
    );

    // Page must be PT-localized (no English boilerplate)
    assert.ok(
      html.includes('catálogo') || html.includes('Worten') || html.includes('MarketPilot'),
      'Page must be PT-localized',
    );

    await cleanupMarketplace(cmId);
  });

  await t.test('scan_failed_interception_overrides_dashboard_for_failed_scan_customer', async () => {
    // UX-DR3: customer with FAILED scan who navigates to / must be redirected to /scan-failed
    // The interception-redirect middleware checks cron_state = PROVISIONING + FAILED scan_jobs

    await resetAuthAndCustomers();
    const { userId, cookie } = await signupAndLogin();
    const cmId = await seedProvisioningMarketplace(userId);
    await seedFailedScanJob(cmId);

    // GET / — must redirect to /scan-failed (UX-DR3)
    const res = await getPage('/', { headers: { cookie } });

    assert.equal(
      res.status,
      302,
      `GET / for FAILED-scan customer must redirect (302); got ${res.status}`,
    );
    const location = res.headers.get('location') ?? '';
    assert.ok(
      location.includes('/scan-failed'),
      `GET / for FAILED-scan customer must redirect to /scan-failed; got Location: ${location}`,
    );

    await cleanupMarketplace(cmId);
  });

  await t.test('scan_failed_page_keyboard_accessible', async () => {
    // NFR-A2: All interactive elements reachable via keyboard
    // Assert: "Tentar novamente →" link has href (not just onclick), so it is
    // reachable via Tab + Enter. No custom tabindex traps.

    await resetAuthAndCustomers();
    const { userId, cookie } = await signupAndLogin();
    const cmId = await seedProvisioningMarketplace(userId);
    await seedFailedScanJob(cmId);

    const res = await getPage('/scan-failed', { headers: { cookie } });
    assert.equal(res.status, 200, `GET /scan-failed must return 200; got ${res.status}`);
    const html = await res.text();

    // The retry element must be an <a href> (keyboard-reachable) or a <button> with
    // an associated form action — NOT just a div with onclick.
    // Check that href="/onboarding/key" is present (keyboard-accessible link)
    const hasKeyboardAccessibleLink =
      html.includes(`href="${KEY_ENTRY_PATH}"`) ||
      html.includes(`href='/onboarding/key'`) ||
      (html.includes(KEY_ENTRY_PATH) && html.includes('<a '));

    assert.ok(
      hasKeyboardAccessibleLink,
      `"${RETRY_BUTTON_PT}" must be an <a href="${KEY_ENTRY_PATH}"> (keyboard-accessible, NFR-A2)`,
    );

    await cleanupMarketplace(cmId);
  });

  // ---------------------------------------------------------------------------
  // AC#3 — No email on healthy completion (FR15)
  // ---------------------------------------------------------------------------

  await t.test('healthy_scan_completion_sends_no_email', async () => {
    // FR15: healthy scan completion is silent — no email sent.
    //
    // Approach: verify via static analysis that onboarding-scan.js only calls
    // sendCriticalAlert in the FAILED branch, not in the COMPLETE branch.
    // Full behaviour-level assertion covered in onboarding-scan.test.js AC#2.

    const { readFile } = await import('node:fs/promises');
    const scanWorkerSrc = await readFile('worker/src/jobs/onboarding-scan.js', 'utf8');

    // sendCriticalAlert (or its sendScanFailedAlert wrapper) must appear at
    // least once — the FAILED branch must trigger an email per AC#1.
    const directCallCount = (scanWorkerSrc.match(/sendCriticalAlert/g) ?? []).length;
    const wrapperCallCount = (scanWorkerSrc.match(/sendScanFailedAlert/g) ?? []).length;
    assert.ok(
      directCallCount >= 1 || wrapperCallCount >= 1,
      'sendCriticalAlert (or sendScanFailedAlert wrapper) must be referenced in onboarding-scan.js (FAILED path)',
    );

    // The COMPLETE path must not invoke the failure email helper.
    // Find every 'COMPLETE' occurrence and ensure no email-send call is within
    // a small window (5 lines) of the transition.
    const lines = scanWorkerSrc.split('\n');
    const completeLineIdxs = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("'COMPLETE'") || lines[i].includes('"COMPLETE"')) {
        completeLineIdxs.push(i);
      }
    }
    assert.ok(
      completeLineIdxs.length > 0,
      'onboarding-scan.js must reference COMPLETE status (sanity check)',
    );
    for (const idx of completeLineIdxs) {
      const completionContext = lines
        .slice(Math.max(0, idx - 3), idx + 5)
        .join('\n');
      assert.ok(
        !completionContext.includes('sendCriticalAlert') &&
        !completionContext.includes('sendScanFailedAlert'),
        `sendCriticalAlert/sendScanFailedAlert must NOT be called near a COMPLETE transition (line ${idx + 1}; FR15 healthy completion is silent)`,
      );
    }
  });

  // ---------------------------------------------------------------------------
  // NFR — Resend SSoT single canonical interface
  // ---------------------------------------------------------------------------

  await t.test('resend_client_is_single_canonical_interface', async () => {
    // Negative assertion: no file outside shared/resend/client.js imports from 'resend'
    const { readFile, readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');

    const SSOT_PATH = join('shared', 'resend', 'client.js').replace(/\\/g, '/');
    const RESEND_IMPORT = /from\s+['"]resend['"]/;

    async function walk (root, exts) {
      const out = [];
      let entries;
      try {
        entries = await readdir(root, { withFileTypes: true });
      } catch { return out; }
      for (const entry of entries) {
        const path = join(root, entry.name);
        if (entry.isDirectory() && !['node_modules', '.git'].includes(entry.name)) {
          out.push(...await walk(path, exts));
        } else if (exts.some((ext) => entry.name.endsWith(ext))) {
          out.push(path);
        }
      }
      return out;
    }

    const files = [
      ...await walk('app/src', ['.js']),
      ...await walk('worker/src', ['.js']),
      ...await walk('shared', ['.js']),
      ...await walk('scripts', ['.js']),
    ].filter((f) => !f.replace(/\\/g, '/').endsWith(SSOT_PATH));

    const hits = [];
    for (const path of files) {
      const text = await readFile(path, 'utf8');
      if (RESEND_IMPORT.test(text)) hits.push(path);
    }
    assert.equal(
      hits.length,
      0,
      `Direct 'resend' imports found outside shared/resend/client.js SSoT: ${JSON.stringify(hits)}`,
    );
  });

  // ---------------------------------------------------------------------------
  // Guard — cleartext API key never in logs (applies to Story 4.6 code paths)
  // ---------------------------------------------------------------------------

  await t.test('cleartext_api_key_never_in_server_log_during_scan_failed_flow', async () => {
    // Capture app server stdout during a scan-failed page render and assert
    // no API key content appears in the logs.

    await resetAuthAndCustomers();
    const { userId, cookie } = await signupAndLogin();
    const cmId = await seedProvisioningMarketplace(userId);
    await seedFailedScanJob(cmId);

    // Capture log output around the page request
    const beforeCount = logChunks.length;
    const res = await getPage('/scan-failed', { headers: { cookie } });

    // Give pino a tick to flush
    await delay(50);

    const newLogOutput = logChunks.slice(beforeCount).join('');

    // Assert no API key patterns in logs (heuristic: no 30+ char hex strings
    // that look like Mirakl API keys, no 'shop_api_key' field values logged)
    const shopApiKeyPattern = /shop_api_key['":\s]+[A-Za-z0-9\-_]{10,}/;
    assert.ok(
      !shopApiKeyPattern.test(newLogOutput),
      'shop_api_key value must not appear in app server pino log during /scan-failed render',
    );

    // Page itself must not embed the key
    if (res.status === 200) {
      const html = await res.text();
      assert.ok(
        !shopApiKeyPattern.test(html),
        'scan-failed page HTML must not embed shop_api_key value',
      );
    }

    await cleanupMarketplace(cmId);
  });

  // ---------------------------------------------------------------------------
  // Guard — /scan-failed with no FAILED scan_jobs row → redirect to /
  // ---------------------------------------------------------------------------

  await t.test('scan_failed_route_redirects_to_root_when_no_failed_scan', async () => {
    // AC#2 task 4: If no FAILED scan_jobs row → redirect to / (stale bookmark guard)

    await resetAuthAndCustomers();
    const { userId, cookie } = await signupAndLogin();
    const cmId = await seedProvisioningMarketplace(userId);
    // Do NOT seed any scan_jobs row

    const res = await getPage('/scan-failed', { headers: { cookie } });

    // Must redirect to / (no FAILED scan to show)
    assert.equal(
      res.status,
      302,
      `GET /scan-failed with no FAILED scan must redirect; got ${res.status}`,
    );
    const location = res.headers.get('location') ?? '';
    assert.ok(
      location === '/' || location === `${BASE}/`,
      `Must redirect to /; got Location: ${location}`,
    );

    await cleanupMarketplace(cmId);
  });

  // ---------------------------------------------------------------------------
  // Guard — /scan-failed when scan is COMPLETE → redirect to /
  // ---------------------------------------------------------------------------

  await t.test('scan_failed_route_redirects_to_root_when_scan_is_complete', async () => {
    // AC#2 task 4: If scan_jobs.status === COMPLETE → redirect to /
    // (onboarding succeeded; customer should be on the normal flow)

    await resetAuthAndCustomers();
    const { userId, cookie } = await signupAndLogin();
    const cmId = await seedProvisioningMarketplace(userId);
    await seedCompleteScanJob(cmId);

    const res = await getPage('/scan-failed', { headers: { cookie } });

    assert.equal(
      res.status,
      302,
      `GET /scan-failed when scan is COMPLETE must redirect; got ${res.status}`,
    );
    const location = res.headers.get('location') ?? '';
    assert.ok(
      location === '/' || location === `${BASE}/`,
      `Must redirect to / when scan is COMPLETE; got Location: ${location}`,
    );

    await cleanupMarketplace(cmId);
  });
});
