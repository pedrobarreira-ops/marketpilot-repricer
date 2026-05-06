// Story 4.9 / AC#1-AC#2 — Dashboard root in DRY_RUN minimal landing tests.
//
// Covers:
//   AC#1 — Customer with DRY_RUN state lands on minimal dry-run dashboard:
//           Blue banner with verbatim PT copy from UX skeleton §9.5
//           No Go-Live button (ships in Epic 8)
//           /audit link present
//   AC#2 — Customer with PROVISIONING state: GET / → 302 /onboarding/scan (UX-DR2)
//
// Local-only: requires `.env.test` pointing at a local Supabase docker.
//
// Run with: node --env-file=.env.test --test tests/app/routes/dashboard/dry-run-minimal.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000';

// Verbatim PT copy from UX skeleton §9.5 (DRY_RUN banner)
// Amelia: replace ellipsis with exact copy from UX skeleton at ATDD Step 2
const DRY_RUN_BANNER_COPY_FRAGMENT = 'modo de simulação';

test('dashboard-dry-run-minimal', async (t) => {
  // ---------------------------------------------------------------------------
  // AC#1 — DRY_RUN landing renders correctly
  // ---------------------------------------------------------------------------

  await t.test('dry_run_banner_renders_with_pt_copy', async () => {
    // TODO (ATDD Step 2):
    // 1. Create customer with cron_state = DRY_RUN + margin set (post-onboarding complete)
    // 2. GET / with session cookie
    // 3. Assert: response is 200 (not redirect)
    // 4. Assert: HTML contains blue banner element
    // 5. Assert: HTML contains DRY_RUN_BANNER_COPY_FRAGMENT (verbatim PT copy from §9.5)
    //    UPDATE: replace DRY_RUN_BANNER_COPY_FRAGMENT constant above with exact §9.5 copy
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('dry_run_page_has_no_go_live_button', async () => {
    // TODO (ATDD Step 2):
    // GET / for DRY_RUN customer
    // Assert: HTML does NOT contain Go-Live button / CTA (ships in Epic 8 Story 8.6)
    // Use negative assertion: assert HTML does not include 'go-live', 'Go Live', 'Ativar repricing'
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('dry_run_page_links_to_audit_log', async () => {
    // TODO (ATDD Step 2):
    // GET / for DRY_RUN customer
    // Assert: HTML contains <a href="/audit"> link (audit log will populate as cycles run)
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#2 — PROVISIONING customer redirected
  // ---------------------------------------------------------------------------

  await t.test('provisioning_customer_redirected_to_onboarding_scan', async () => {
    // TODO (ATDD Step 2):
    // Customer with cron_state = PROVISIONING (no scan started yet)
    // GET / → assert 302 → /onboarding/scan
    assert.fail('ATDD stub — implement at Step 2');
  });
});
