// tests/worker/safety/reconciliation.additional.test.js
//
// J2 (Epic 7 retro 2026-05-14) — Supplemental behavioural coverage for
// worker/src/safety/reconciliation.js critical-path skip branches:
//   - Decrypt-failure skip (deferred-work.md:498)
//   - P11 fetch-failure skip (deferred-work.md:499)
//
// Both branches `continue` to the next row WITHOUT bumping last_checked_at and
// WITHOUT emitting audit events. Production-safety invariant: silent-skip on
// per-row credential/upstream failures so a single bad SKU/customer doesn't
// abort the entire nightly sweep.
//
// Helpers (buildMockPool / buildMockLogger / buildSkuChannel / runWithDeps)
// duplicate the local helpers in reconciliation.test.js — that file's helpers
// are not exported, and duplicating is cheaper than refactoring into a shared
// fixture for two additional cases. If a third supplement lands, consider
// promoting the helpers to a shared module under tests/_helpers/.
//
// Run with: node --test tests/worker/safety/reconciliation.additional.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// MASTER_KEY_BASE64 stub mirrors reconciliation.test.js — reconciliation.js's
// getMasterKey() reads this env var lazily. Set BEFORE the dynamic import path.
if (!process.env.MASTER_KEY_BASE64) {
  process.env.MASTER_KEY_BASE64 = Buffer.from('a'.repeat(32)).toString('base64');
}

function buildMockPool ({ selectResult = { rows: [], rowCount: 0 }, updateRowCount = 1 } = {}) {
  const calls = [];
  const client = {
    _calls: calls,
    async query (sql, params = []) {
      calls.push({ sql, params });
      const t = sql.trim().toUpperCase();
      if (t.startsWith('SELECT')) return selectResult;
      if (t.startsWith('UPDATE')) return { rows: [], rowCount: updateRowCount };
      if (t.startsWith('INSERT')) return { rows: [{ id: 'mock-audit-id' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };
  return { pool: { connect: async () => client }, client };
}

function buildMockLogger () {
  const warns = [];
  const infos = [];
  const errors = [];
  const logger = {
    warn: (...a) => warns.push(a),
    info: (...a) => infos.push(a),
    error: (...a) => errors.push(a),
    debug: () => {},
    child: () => logger,
  };
  return { logger, warns, infos, errors };
}

function buildSkuChannel (overrides = {}) {
  return {
    id: 'sc-1',
    sku_id: 'sku-1',
    customer_marketplace_id: 'cm-1',
    channel_code: 'WRT_PT_ONLINE',
    tier: '3',
    tier_cadence_minutes: 1440,
    last_checked_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    last_won_at: null,
    current_price_cents: 3000,
    min_shipping_price_cents: 0,
    list_price_cents: 3000,
    ean: '1234567890123',
    base_url: 'https://worten.marketplace.com',
    shop_name: 'Easy - Store',
    shop_api_key_ciphertext: 'mock-ciphertext',
    shop_api_key_nonce: 'mock-nonce',
    shop_api_key_auth_tag: 'mock-auth-tag',
    ...overrides,
  };
}

async function runWithDeps (pool, logger, deps) {
  const mod = await import('../../../worker/src/safety/reconciliation.js');
  return mod.runReconciliationPass({ pool, logger, _deps: deps });
}

// ---------------------------------------------------------------------------
// Test A — Decrypt-failure skip branch
// reconciliation.js:247-253 — when decryptFn throws, the row is skipped via
// `continue`. Assert: no P11 call, no tier classification, no audit write,
// no UPDATE (last_checked_at NOT bumped on decrypt-skip), skusEvaluated still
// increments, warn-log emitted with the err.message.
// ---------------------------------------------------------------------------

describe('reconciliation — decrypt-failure skip (J2 deferred-work.md:498)', () => {
  test('decryptFn_throws_skips_row_no_p11_no_audit_no_update_warn_logged', async () => {
    const row = buildSkuChannel({ id: 'sc-decrypt-fail', customer_marketplace_id: 'cm-decrypt' });
    const { pool, client } = buildMockPool({ selectResult: { rows: [row], rowCount: 1 } });
    const { logger, warns } = buildMockLogger();

    let p11Calls = 0;
    let tierClassifierCalls = 0;
    let auditWriterCalls = 0;

    const result = await runWithDeps(pool, logger, {
      p11Fetcher: async () => { p11Calls++; return []; },
      selfFilter: (offers) => ({ filteredOffers: offers, collisionDetected: false }),
      auditWriter: async () => { auditWriterCalls++; return { id: 'mock' }; },
      tierClassifier: async () => { tierClassifierCalls++; return { tierTransitioned: false }; },
      decryptFn: () => { throw new Error('decrypt-failure-simulated'); },
    });

    // skusEvaluated counts every row reached in the loop — even skipped ones —
    // because the iteration entered before the continue. Pin the expected
    // value (1) so the counter contract is explicit.
    assert.equal(result.skusEvaluated, 1, 'skusEvaluated must still increment on decrypt-skip');

    assert.equal(p11Calls, 0, 'decrypt-skip must NOT proceed to P11 fetch');
    assert.equal(tierClassifierCalls, 0, 'decrypt-skip must NOT call tierClassifier');
    assert.equal(auditWriterCalls, 0, 'decrypt-skip must NOT emit any audit event');

    // No UPDATE issued — last_checked_at NOT bumped on decrypt-skip (distinct
    // from collision-skip + race-loser which DO bump last_checked_at).
    const updateCalls = client._calls.filter(c => c.sql.trim().toUpperCase().startsWith('UPDATE'));
    assert.equal(updateCalls.length, 0, 'decrypt-skip must NOT issue an UPDATE — last_checked_at intentionally NOT bumped so the row retries next night');

    // Warn log must include the err message + skuChannelId + customerMarketplaceId.
    const decryptWarn = warns.find(w => /failed to decrypt/i.test(JSON.stringify(w)));
    assert.ok(decryptWarn, 'a "failed to decrypt shop API key" warn-log must be emitted on decryptFn throw');
    const warnPayload = decryptWarn[0];
    assert.equal(warnPayload.skuChannelId, 'sc-decrypt-fail', 'warn payload must include skuChannelId');
    assert.equal(warnPayload.customerMarketplaceId, 'cm-decrypt', 'warn payload must include customerMarketplaceId');
  });
});

// ---------------------------------------------------------------------------
// Test B — P11 fetch-failure skip branch
// reconciliation.js:269-275 — when p11Fetcher rejects, the row is skipped via
// `continue`. Assert: no tier classification, no audit write, no UPDATE
// (last_checked_at NOT bumped), skusEvaluated still increments, warn-log
// emitted with EAN + err.message + ids.
// ---------------------------------------------------------------------------

describe('reconciliation — P11 fetch-failure skip (J2 deferred-work.md:499)', () => {
  test('p11Fetcher_rejects_skips_row_no_audit_no_update_warn_logged', async () => {
    const row = buildSkuChannel({ id: 'sc-p11-fail', customer_marketplace_id: 'cm-p11', ean: '9999999999999' });
    const { pool, client } = buildMockPool({ selectResult: { rows: [row], rowCount: 1 } });
    const { logger, warns } = buildMockLogger();

    let tierClassifierCalls = 0;
    let auditWriterCalls = 0;

    const result = await runWithDeps(pool, logger, {
      p11Fetcher: async () => { throw new Error('p11-down-simulated'); },
      selfFilter: (offers) => ({ filteredOffers: offers, collisionDetected: false }),
      auditWriter: async () => { auditWriterCalls++; return { id: 'mock' }; },
      tierClassifier: async () => { tierClassifierCalls++; return { tierTransitioned: false }; },
      decryptFn: () => 'mock-api-key',
    });

    assert.equal(result.skusEvaluated, 1, 'skusEvaluated must increment even on P11-skip');
    assert.equal(tierClassifierCalls, 0, 'P11-skip must NOT call tierClassifier');
    assert.equal(auditWriterCalls, 0, 'P11-skip must NOT emit any audit event');

    const updateCalls = client._calls.filter(c => c.sql.trim().toUpperCase().startsWith('UPDATE'));
    assert.equal(updateCalls.length, 0, 'P11-skip must NOT issue an UPDATE — last_checked_at intentionally NOT bumped so the row retries next night');

    const p11Warn = warns.find(w => /P11 fetch failed/i.test(JSON.stringify(w)));
    assert.ok(p11Warn, 'a "P11 fetch failed" warn-log must be emitted on p11Fetcher reject');
    const warnPayload = p11Warn[0];
    assert.equal(warnPayload.skuChannelId, 'sc-p11-fail', 'warn payload must include skuChannelId');
    assert.equal(warnPayload.customerMarketplaceId, 'cm-p11', 'warn payload must include customerMarketplaceId');
    assert.equal(warnPayload.ean, '9999999999999', 'warn payload must include EAN for upstream debugging');
  });
});
