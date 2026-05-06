// Story 4.8 / AC#1-AC#4 — Margin question + smart-default mapping tests.
//
// Covers:
//   AC#1 — GET /onboarding/margin renders 4 radio bands (PT-localized)
//   AC#2 — Selecting <5% shows warning callout with 3 bullet recommendations
//           Submit blocked until "Compreendo e continuo" clicked
//   AC#3 — POST /onboarding/margin persists max_discount_pct per smart-default mapping:
//           <5%    → 0.005  |  5-10% → 0.01  |  10-15% → 0.02  |  15%+ → 0.03
//           max_increase_pct always → 0.05
//           Redirects to /
//   AC#4 — UX-DR2 forward-only: revisiting /onboarding/margin after margin set → 302 /
//
// Local-only: requires `.env.test` pointing at a local Supabase docker.
//
// Run with: node --env-file=.env.test --test tests/app/routes/onboarding/margin.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000';

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

// Smart-default mapping per Story 4.8 AC#3
const BAND_MAPPINGS = [
  { band: 'under_5', expectedMaxDiscount: 0.005 },
  { band: '5_10', expectedMaxDiscount: 0.01 },
  { band: '10_15', expectedMaxDiscount: 0.02 },
  { band: '15_plus', expectedMaxDiscount: 0.03 },
];

test('margin-question', async (t) => {
  // ---------------------------------------------------------------------------
  // AC#1 — Page renders 4 radio bands
  // ---------------------------------------------------------------------------

  await t.test('margin_page_renders_4_radio_bands', async () => {
    // TODO (ATDD Step 2):
    // Customer with DRY_RUN state (past scan-ready): GET /onboarding/margin
    // Assert HTML contains 4 radio inputs with values/labels:
    //   <5%, 5-10%, 10-15%, 15%+ (PT-localized labels)
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#2 — <5% warning callout
  // ---------------------------------------------------------------------------

  await t.test('selecting_under_5_pct_shows_warning_callout', async () => {
    // TODO (ATDD Step 2):
    // GET /onboarding/margin; assert HTML contains the warning callout element (may be hidden)
    // UX skeleton §9.10: yellow-edged box + info icon + 3 bullet recommendations
    // + "Compreendo e continuo" acknowledgement button
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('under_5_pct_requires_acknowledge_before_submit', async () => {
    // TODO (ATDD Step 2):
    // POST /onboarding/margin with band=under_5 WITHOUT acknowledge=true
    // Assert: form submission rejected or redirects back to margin page
    // (Client-side enforced; server-side double-check for the acknowledgement flag)
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#3 — Smart-default mapping persistence
  // ---------------------------------------------------------------------------

  for (const { band, expectedMaxDiscount } of BAND_MAPPINGS) {
    await t.test(`submit_${band}_persists_${String(expectedMaxDiscount).replace('.', '')}_max_discount`, async () => {
      // TODO (ATDD Step 2):
      // POST /onboarding/margin with band selection (+ acknowledge for under_5)
      // Assert: customer_marketplaces.max_discount_pct === expectedMaxDiscount
      assert.fail('ATDD stub — implement at Step 2');
    });
  }

  await t.test('submit_persists_005_max_increase_global_default', async () => {
    // TODO (ATDD Step 2):
    // After any band submission: assert customer_marketplaces.max_increase_pct === 0.05
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('submit_redirects_to_dashboard_root', async () => {
    // TODO (ATDD Step 2):
    // POST /onboarding/margin → assert 302 → /
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#4 — UX-DR2 forward-only
  // ---------------------------------------------------------------------------

  await t.test('ux_dr2_forward_only_blocks_revisit_after_margin_set', async () => {
    // TODO (ATDD Step 2):
    // Customer with max_discount_pct already set: GET /onboarding/margin → 302 /
    assert.fail('ATDD stub — implement at Step 2');
  });
});
