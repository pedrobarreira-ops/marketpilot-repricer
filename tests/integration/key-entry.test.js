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

test('key-entry integration', async (t) => {
  // Wait for app server readiness
  const deadline = Date.now() + 60_000;
  let healthy = false;
  while (Date.now() < deadline && !healthy) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok || res.status === 302) healthy = true;
    } catch { /* not ready yet */ }
    if (!healthy) await delay(500);
  }
  assert.ok(healthy, 'app server did not respond within 60s');

  // ---------------------------------------------------------------------------
  // AC#1 — GET /onboarding/key renders the key entry form
  // ---------------------------------------------------------------------------

  await t.test('get_onboarding_key_renders_form_for_provisioning_customer', async () => {
    // TODO (ATDD Step 2):
    // 1. Sign up a customer (POST /signup)
    // 2. Create customer_marketplaces row in PROVISIONING (via service-role SQL or route)
    // 3. GET /onboarding/key with session cookie
    // 4. Assert response contains: key input, trust block, "Como gerar a chave?" link,
    //    "Validar chave" button (disabled until input non-empty)
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#2 — Trust block renders with verbatim PT copy (UX-DR23)
  // ---------------------------------------------------------------------------

  await t.test('trust_block_renders_pt_copy_and_lock_icon', async () => {
    // TODO (ATDD Step 2):
    // Assert HTML contains:
    //   - lock icon (svg or class containing "lock")
    //   - "encriptada em repouso" PT copy substring
    //   - "Ver as nossas garantias" link text
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#3 — Valid key: vault row + customer_marketplace PROVISIONING + redirect
  // ---------------------------------------------------------------------------

  await t.test('valid_key_creates_vault_row_and_customer_marketplace_in_provisioning', async () => {
    // TODO (ATDD Step 2):
    // 1. Sign up customer, get session cookie
    // 2. Configure mock Mirakl server to return 200 for P11 reference EAN call
    // 3. POST /onboarding/key/validate with a synthetic key
    // 4. Assert: shop_api_key_vault row exists with encrypted key (ciphertext ≠ raw key)
    // 5. Assert: customer_marketplaces row in PROVISIONING, A01/PC01 columns NULL
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('valid_key_redirects_to_onboarding_scan', async () => {
    // TODO (ATDD Step 2):
    // Assert POST /onboarding/key/validate response: 302 → /onboarding/scan
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('valid_key_sets_last_validated_at_on_vault_row', async () => {
    // TODO (ATDD Step 2):
    // Assert shop_api_key_vault.last_validated_at IS NOT NULL after successful validation
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('invalid_key_401_returns_inline_pt_error_no_vault_row', async () => {
    // TODO (ATDD Step 2):
    // 1. Configure mock server to return 401 for the P11 call
    // 2. POST /onboarding/key/validate
    // 3. Assert: 400/200 with inline error (no redirect)
    // 4. Assert: zero shop_api_key_vault rows for this customer
    // 5. Assert: zero customer_marketplaces rows for this customer
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('network_timeout_returns_inline_retry_cta', async () => {
    // TODO (ATDD Step 2):
    // 1. Configure mock server to delay response > 5s
    // 2. POST /onboarding/key/validate
    // 3. Assert: response contains "retry" CTA (PT-localized)
    // 4. Assert: no vault row, no customer_marketplaces row
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('cleartext_key_never_appears_in_pino_output', async () => {
    // TODO (ATDD Step 2):
    // Capture pino log output (pipe to test buffer), run validation, assert raw key
    // string does not appear in any log line (use a recognizable synthetic key prefix)
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('no_audit_event_emitted_on_key_validated', async () => {
    // TODO (ATDD Step 2):
    // Assert audit_log count is unchanged before/after successful key validation
    // (KEY_VALIDATED is NOT in the AD20 event taxonomy)
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#5 — Guide modal
  // ---------------------------------------------------------------------------

  await t.test('guide_modal_renders_pt_walkthrough_content', async () => {
    // TODO (ATDD Step 2):
    // GET /onboarding/key, assert modal HTML contains:
    //   - 3-step walkthrough copy (Worten Seller Center → Account → API)
    //   - "Fechar" button
    //   - keyboard accessible (tabindex / role present)
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#6 — Full integration flows
  // ---------------------------------------------------------------------------

  await t.test('integration_test_valid_key_full_flow', async () => {
    // TODO (ATDD Step 2):
    // End-to-end: signup → mock-validate key → assert vault row + PROVISIONING row + redirect
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('integration_test_invalid_key_no_side_effects', async () => {
    // TODO (ATDD Step 2):
    // End-to-end: signup → 401 key attempt → assert zero vault rows + zero marketplace rows
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('integration_test_timeout_no_side_effects', async () => {
    // TODO (ATDD Step 2):
    // End-to-end: signup → timeout key attempt → assert zero vault rows + zero marketplace rows
    assert.fail('ATDD stub — implement at Step 2');
  });
});
