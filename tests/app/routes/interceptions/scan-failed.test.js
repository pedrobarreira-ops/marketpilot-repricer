// Story 4.6 / AC#1-AC#3 — Scan-failed email + /scan-failed interception tests.
//
// Covers:
//   AC#1 — Scan failure triggers email via sendCriticalAlert within 5min (NFR-P9)
//           Email subject: "A análise do teu catálogo MarketPilot não conseguiu completar"
//           Email HTML rendered from scan-failed.eta template
//   AC#2 — /scan-failed interception page renders with failure_reason + retry button
//           UX-DR3: customer with FAILED scan who logs in lands on /scan-failed (not /)
//           Page is keyboard accessible (NFR-A2)
//   AC#3 — Healthy scan completion sends NO email (FR15)
//   NFR  — shared/resend/client.js is the single canonical Resend interface (grep assertion)
//
// Local-only: requires `.env.test` pointing at a local Supabase docker.
// sendCriticalAlert is stubbed — no actual Resend API calls.
//
// Run with: node --env-file=.env.test --test tests/app/routes/interceptions/scan-failed.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000';

test('scan-failed interception', async (t) => {
  // ---------------------------------------------------------------------------
  // AC#1 — Email on scan failure
  // ---------------------------------------------------------------------------

  await t.test('scan_failure_email_sent_within_5min', async () => {
    // TODO (ATDD Step 2):
    // Stub sendCriticalAlert to capture call args
    // Trigger scan failure (worker processes FAILED scan_jobs row)
    // Assert: sendCriticalAlert called within timeout
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_failure_email_subject_is_correct_pt_string', async () => {
    // TODO (ATDD Step 2):
    // Assert captured sendCriticalAlert call has:
    //   subject: "A análise do teu catálogo MarketPilot não conseguiu completar"
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_failure_email_html_rendered_from_eta_template', async () => {
    // TODO (ATDD Step 2):
    // Assert html body is non-empty; contains failure_reason; contains /onboarding/key link
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#2 — /scan-failed page
  // ---------------------------------------------------------------------------

  await t.test('scan_failed_page_renders_with_failure_reason_and_retry_button', async () => {
    // TODO (ATDD Step 2):
    // GET /scan-failed for customer with FAILED scan
    // Assert: failure_reason text present; "Tentar novamente →" button links to /onboarding/key
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_failed_interception_overrides_dashboard_for_failed_scan_customer', async () => {
    // TODO (ATDD Step 2):
    // Customer with FAILED scan logs in (GET /): assert redirected to /scan-failed not /
    // UX-DR3: interception takes precedence over default landing
    assert.fail('ATDD stub — implement at Step 2');
  });

  await t.test('scan_failed_page_keyboard_accessible', async () => {
    // TODO (ATDD Step 2):
    // Assert HTML has correct aria roles + tabindex on interactive elements
    // "Tentar novamente →" link reachable via keyboard (href, not button)
    assert.fail('ATDD stub — implement at Step 2');
  });

  // ---------------------------------------------------------------------------
  // AC#3 — No email on healthy completion
  // ---------------------------------------------------------------------------

  await t.test('healthy_scan_completion_sends_no_email', async () => {
    // TODO (ATDD Step 2):
    // Stub sendCriticalAlert; run scan to COMPLETE
    // Assert: sendCriticalAlert NOT called
    assert.fail('ATDD stub — implement at Step 2');
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
});
