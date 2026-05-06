// Story 4.7 / AC#1-AC#4 — Scan-ready interstitial /onboarding/scan-ready tests.
//
// Covers:
//   AC#1 — Page renders live counts from DB (not placeholders):
//           X products, Y repricing-ready (tier 1/2a/2b), Z Tier-3, W without-EAN
//   AC#2 — "porquê?" disclosure expands with verbatim PT copy (UX-DR34)
//   AC#3 — "Continuar →" button redirects to /onboarding/margin (302)
//   AC#4 — UX-DR2 forward-only: customer in DRY_RUN accessing /onboarding/scan → 302 /onboarding/scan-ready
//
// Local-only: requires `.env.test` pointing at a local Supabase docker.
//
// Run with: node --env-file=.env.test --test tests/app/routes/onboarding/scan-ready.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000';

// Verbatim PT copy per UX skeleton §8.3 (UX-DR34)
const PORQUÊ_DISCLOSURE_COPY = [
  'Produtos refurbished e listings privados não têm EAN partilhado no Worten',
  'não conseguimos ver competidores no mesmo produto',
  'Ficam fora do scope do repricing automático',
  'Isto é estrutural ao Worten, não uma limitação da MarketPilot',
].join('');

test('scan-ready interstitial', async (t) => {
  // ---------------------------------------------------------------------------
  // AC#1 — Live counts from DB
  // ---------------------------------------------------------------------------

  await t.test('scan_ready_renders_counts_from_db_not_placeholders', async () => {
    // TODO (ATDD Step 2):
    // 1. Seed sku_channels with known tier distribution (e.g., 10 T1, 5 T2a, 3 T2b, 8 T3)
    //    and some skus without EAN (no sku_channels row)
    // 2. GET /onboarding/scan-ready for this customer
    // 3. Assert HTML contains the exact numeric counts matching DB state
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_ready_shows_total_sku_count', async () => {
    // TODO (ATDD Step 2):
    // Assert "X produtos encontrados no Worten" label with correct X
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_ready_shows_tier3_and_no_ean_counts', async () => {
    // TODO (ATDD Step 2):
    // Assert Tier-3 count (Z) and without-EAN count (W) are present and correct
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#2 — "porquê?" disclosure
  // ---------------------------------------------------------------------------

  await t.test('por_que_disclosure_expands_with_verbatim_pt_copy', async () => {
    // TODO (ATDD Step 2):
    // GET /onboarding/scan-ready; assert each segment of PORQUÊ_DISCLOSURE_COPY present in HTML
    // (Disclosure may be collapsed by default — assert the copy exists in DOM even if hidden)
    const EXPECTED_SEGMENTS = [
      'Produtos refurbished e listings privados não têm EAN partilhado no Worten',
      'não conseguimos ver competidores no mesmo produto',
      'Ficam fora do scope do repricing automático',
      'Isto é estrutural ao Worten, não uma limitação da MarketPilot',
    ];
    // Stubs; real assertions added at ATDD Step 2
    for (const segment of EXPECTED_SEGMENTS) {
      assert.ok(segment.length > 0, `disclosure segment must be non-empty: "${segment}"`);
    }
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#3 — "Continuar →" redirects to /onboarding/margin
  // ---------------------------------------------------------------------------

  await t.test('continuar_button_redirects_to_onboarding_margin', async () => {
    // TODO (ATDD Step 2):
    // POST /onboarding/scan-ready (or GET the redirect target)
    // Assert: 302 → /onboarding/margin
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#4 — UX-DR2 forward-only
  // ---------------------------------------------------------------------------

  await t.test('ux_dr2_forward_only_blocks_back_to_scan', async () => {
    // TODO (ATDD Step 2):
    // Customer with cron_state = DRY_RUN: GET /onboarding/scan → 302 /onboarding/scan-ready
    assert.fail('ATDD stub — implement at Step 2');
  });
});
