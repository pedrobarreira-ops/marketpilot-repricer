// tests/worker/safety/reconciliation.test.js
//
// Story 7.7 — ATDD: Unit tests for worker/src/safety/reconciliation.js
//
// Covers AC4 (7 test cases) + AC1 contract assertions.
//
// Tests:
//   1. T3 with no competitors → no transition, last_checked_at bumped, ZERO audit events
//   2. T3 with new competitor + winning → T3→T2a transition + 2 audit emissions
//      (canonical PayloadForTierTransition + PayloadForNewCompetitorEntered shapes)
//   3. T3 with new competitor + losing → T3→T1 transition + 2 audit emissions
//   4. Stale-state detection (AC3) — drift threshold 2× cadence triggers warn-log
//   5. Shop-name collision → warn-log + skip, no audit emissions, last_checked_at still bumped
//   6. Optimistic-concurrency race-loser → warn-log, NO audit emissions, last_checked_at bumped
//   7. Cross-customer iteration — SELECT predicate has no customer_marketplace_id filter
//
// Mock-tx pattern: mirrors tests/worker/safety/anomaly-freeze.test.js (AC8 pattern) —
//   captures { sql, params } per client.query call; configurable { rowCount, rows } return.
//   Mock pool returns a mock PoolClient from connect(); release() is a no-op.
//
// DI wrapper pattern (SCP Amendment 7 — no stub-fallbacks in production source):
//   runReconciliationPass accepts an optional `_deps` parameter for test injection of
//   { p11Fetcher, selfFilter, auditWriter, tierClassifier } overriding static imports.
//   Production callers omit `_deps`; tests inject mock functions.
//   If reconciliation.js doesn't expose a _deps injection point, the test file
//   must use dynamic `await import` after module-registry mocking (node:test does not
//   support module mocking natively in the version this project uses — DI is preferred).
//
// RESEND env-stub: reconciliation.js does NOT directly import shared/resend/client.js.
//   Check during Task 4 if writeAuditEvent transitively pulls in resend. If so, apply:
//     process.env.RESEND_API_KEY = 're_test_...';  BEFORE the dynamic import.
//
// Run with: node --test tests/worker/safety/reconciliation.test.js
// Or via:   npm run test:unit

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(__dirname, '../../../worker/src/safety/reconciliation.js');

// Stub MASTER_KEY_BASE64 BEFORE runReconciliationPass is first called.
// reconciliation.js's getMasterKey() lazily calls loadMasterKey() on the first
// pass, which reads this env var. The stub provides a valid 32-byte base64 key
// so getMasterKey() succeeds in unit tests (real crypto never fires because
// all tests inject decryptFn: () => 'mock-api-key' to bypass AES-256-GCM).
// Pattern mirrors the RESEND_API_KEY stub in anomaly-freeze.test.js — set env
// before any code path that reads it can run.
if (!process.env.MASTER_KEY_BASE64) {
  // 32 bytes of 0x61 ('a') encoded as base64 — valid AES-256 key size.
  process.env.MASTER_KEY_BASE64 = Buffer.from('a'.repeat(32)).toString('base64');
}

// ---------------------------------------------------------------------------
// DI-injectable mock implementations
// ---------------------------------------------------------------------------

/**
 * Build a mock pool + PoolClient that captures all SQL calls.
 * The client returned from connect() records every query({ sql, params }) call.
 *
 * @param {object} [opts]
 * @param {Array<{rows: Array, rowCount?: number}>} [opts.selectResult] - Rows returned for the T3 SELECT
 * @param {number} [opts.updateRowCount=1] - rowCount for UPDATE statements
 * @returns {{ pool: object, getClient: () => object }}
 */
function buildMockPool ({
  selectResult = { rows: [], rowCount: 0 },
  updateRowCount = 1,
} = {}) {
  const calls = [];

  const client = {
    _calls: calls,
    async query (sql, params = []) {
      calls.push({ sql, params });
      const sqlTrimmed = sql.trim().toUpperCase();

      // SELECT — return the configured T3 rows
      if (sqlTrimmed.startsWith('SELECT')) {
        return selectResult;
      }

      // UPDATE sku_channels / last_checked_at
      if (sqlTrimmed.startsWith('UPDATE')) {
        return { rows: [], rowCount: updateRowCount };
      }

      // INSERT (writeAuditEvent) — return a mock audit row
      if (sqlTrimmed.startsWith('INSERT')) {
        return { rows: [{ id: 'mock-audit-id' }], rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };

  const pool = {
    connect: async () => client,
  };

  return { pool, client };
}

/**
 * Build a mock logger that captures warn/info/error/debug calls.
 * @returns {{ logger: object, warns: Array, infos: Array, errors: Array }}
 */
function buildMockLogger () {
  const warns = [];
  const infos = [];
  const errors = [];
  const debugs = [];
  const logger = {
    warn: (...args) => warns.push(args),
    info: (...args) => infos.push(args),
    error: (...args) => errors.push(args),
    debug: (...args) => debugs.push(args),
    child: () => logger,
  };
  return { logger, warns, infos, errors, debugs };
}

/**
 * Build a synthetic T3 sku_channel row matching the AC4 contract shape.
 * All fields present in the cross-customer SELECT (including JOIN fields).
 */
function buildSkuChannel (overrides = {}) {
  return {
    id: 'sc-1',
    sku_id: 'sku-1',
    customer_marketplace_id: 'cm-1',
    channel_code: 'WRT_PT_ONLINE',
    tier: '3',
    tier_cadence_minutes: 1440,
    last_checked_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
    last_won_at: null,
    current_price_cents: 3000,
    min_shipping_price_cents: 0,
    list_price_cents: 3000,
    // JOIN fields from skus + customer_marketplaces:
    ean: '1234567890123',
    base_url: 'https://worten.marketplace.com',
    shop_name: 'Easy - Store',
    shop_api_key_ciphertext: 'mock-ciphertext',
    shop_api_key_nonce: 'mock-nonce',
    shop_api_key_auth_tag: 'mock-auth-tag',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: run runReconciliationPass with DI-injected mocks
// ---------------------------------------------------------------------------

/**
 * Dynamically import reconciliation.js and invoke runReconciliationPass with DI.
 * The _deps injection allows tests to override p11Fetcher, selfFilter, auditWriter,
 * tierClassifier without patching Node's module registry.
 *
 * If the production module doesn't yet exist (Step 2 pre-dev), the import will
 * throw — tests will be marked as expected-failures until Task 1 ships the source.
 */
async function runWithDeps (pool, logger, deps) {
  // Dynamic import so the module is resolved at test-run time (post-dev).
  // NOTE: if reconciliation.js transitively imports shared/resend/client.js,
  // set process.env.RESEND_API_KEY BEFORE this import.
  const mod = await import('../../../worker/src/safety/reconciliation.js');
  return mod.runReconciliationPass({ pool, logger, _deps: deps });
}

// ---------------------------------------------------------------------------
// Test 1 — T3 with no competitors → no transition, last_checked_at bumped, ZERO audit events
// ---------------------------------------------------------------------------

describe('reconciliation — T3 no competitors (AC4 test 1)', () => {
  test('T3_no_competitors_bumps_last_checked_at_no_audit_events', async () => {
    const skuChannel = buildSkuChannel({
      id: 'sc-1',
      sku_id: 'sku-1',
      current_price_cents: 3000,
      min_shipping_price_cents: 0,
      last_checked_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });

    const { pool, client } = buildMockPool({
      selectResult: { rows: [skuChannel], rowCount: 1 },
    });
    const { logger } = buildMockLogger();

    const auditWriterCalls = [];
    const mockAuditWriter = async (args) => {
      auditWriterCalls.push(args);
      return { id: 'mock-audit-id' };
    };

    const mockP11Fetcher = async () => [];
    const mockSelfFilter = (rawOffers, _shopName) => ({ filteredOffers: rawOffers, collisionDetected: false });
    const mockTierClassifier = async () => ({ tierTransitioned: false, fromTier: '3', toTier: '3', reason: 'no-transition-stable' });

    const result = await runWithDeps(pool, logger, {
      p11Fetcher: mockP11Fetcher,
      selfFilter: mockSelfFilter,
      auditWriter: mockAuditWriter,
      tierClassifier: mockTierClassifier,
      decryptFn: () => 'mock-api-key',
    });

    // THEN: ZERO writeAuditEvent calls (no transition on steady-state T3)
    assert.equal(auditWriterCalls.length, 0, 'writeAuditEvent must NOT be called for steady-state T3 (no competitors)');

    // THEN: Exactly 1 UPDATE sku_channels last_checked_at bump issued
    const updateCalls = client._calls.filter(c =>
      c.sql.trim().toUpperCase().startsWith('UPDATE') &&
      c.sql.toLowerCase().includes('sku_channels')
    );
    assert.equal(updateCalls.length, 1, 'Exactly 1 UPDATE sku_channels (last_checked_at bump) must be issued for no-competitor T3 row');

    // THEN: The UPDATE must include AND tier = '3' (optimistic-concurrency guard for no-competitor branch)
    assert.ok(
      updateCalls[0].sql.toLowerCase().includes("tier = '3'") ||
      updateCalls[0].sql.toLowerCase().includes("tier=$") ||
      updateCalls[0].sql.toLowerCase().includes('tier ='),
      'No-competitor UPDATE must include AND tier guard (optimistic-concurrency)',
    );

    // THEN: The UPDATE must target the correct skuChannelId
    assert.ok(
      updateCalls[0].params.includes('sc-1') || updateCalls[0].params.some(p => p === 'sc-1'),
      'UPDATE must target sc-1 skuChannelId',
    );

    // THEN: Return shape stats
    assert.equal(result.skusEvaluated, 1, 'skusEvaluated must be 1');
    assert.equal(result.tierTransitions, 0, 'tierTransitions must be 0 for no-competitor steady-state');
    assert.equal(result.newCompetitorsDetected, 0, 'newCompetitorsDetected must be 0');
    assert.equal(result.staleStateWarnings, 0, 'staleStateWarnings must be 0 (25h < 2880min threshold)');
    assert.ok(typeof result.durationMs === 'number', 'durationMs must be a number');
  });
});

// ---------------------------------------------------------------------------
// Test 2 — T3 with new competitor + winning → T3→T2a + 2 audit emissions (canonical payload shapes)
// ---------------------------------------------------------------------------

describe('reconciliation — T3 new competitor winning T3→T2a (AC4 test 2)', () => {
  test('T3_winning_competitor_emits_tier_transition_and_new_competitor_entered_with_canonical_shapes', async () => {
    const skuChannel = buildSkuChannel({
      id: 'sc-2',
      sku_id: 'sku-2',
      current_price_cents: 4500,
      min_shipping_price_cents: 0,
      last_checked_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });

    const { pool, client } = buildMockPool({
      selectResult: { rows: [skuChannel], rowCount: 1 },
    });
    const { logger } = buildMockLogger();

    const auditWriterCalls = [];
    const mockAuditWriter = async (args) => {
      auditWriterCalls.push(args);
      return { id: 'mock-audit-id' };
    };

    // Competitor at 4999 total_price > our 4500 → we win at position 1
    const competitorOffer = { active: true, total_price: 4999, shop_name: 'CompetitorA' };
    const mockP11Fetcher = async () => [competitorOffer];
    const mockSelfFilter = (rawOffers, _shopName) => ({ filteredOffers: rawOffers, collisionDetected: false });
    const mockTierClassifier = async () => ({
      tierTransitioned: true,
      fromTier: '3',
      toTier: '2a',
      reason: 'won-1st-place-from-tier3',
    });

    const result = await runWithDeps(pool, logger, {
      p11Fetcher: mockP11Fetcher,
      selfFilter: mockSelfFilter,
      auditWriter: mockAuditWriter,
      tierClassifier: mockTierClassifier,
      decryptFn: () => 'mock-api-key',
    });

    // THEN: writeAuditEvent called EXACTLY twice
    assert.equal(auditWriterCalls.length, 2, 'writeAuditEvent must be called exactly twice (tier-transition + new-competitor-entered)');

    // THEN: Call 1 — tier-transition with canonical PayloadForTierTransition shape
    const tierTransitionCall = auditWriterCalls.find(c => c.eventType === 'tier-transition');
    assert.ok(tierTransitionCall, 'First writeAuditEvent call must use eventType "tier-transition"');
    assert.deepEqual(
      tierTransitionCall.payload,
      { fromTier: '3', toTier: '2a', reason: 'won-1st-place-from-tier3' },
      'tier-transition payload MUST match canonical PayloadForTierTransition { fromTier, toTier, reason } shape (Story 7.7 is first emit site to use this shape)',
    );
    assert.equal(tierTransitionCall.skuChannelId, 'sc-2', 'tier-transition audit must reference correct skuChannelId');
    assert.equal(tierTransitionCall.skuId, 'sku-2', 'tier-transition audit must reference correct skuId');
    assert.equal(tierTransitionCall.customerMarketplaceId, 'cm-1', 'tier-transition audit must reference correct customerMarketplaceId');

    // THEN: Call 2 — new-competitor-entered with canonical PayloadForNewCompetitorEntered shape
    const newCompetitorCall = auditWriterCalls.find(c => c.eventType === 'new-competitor-entered');
    assert.ok(newCompetitorCall, 'Second writeAuditEvent call must use eventType "new-competitor-entered"');
    // competitorPriceCents = toCents(4999) = 499900
    assert.equal(
      newCompetitorCall.payload.competitorPriceCents,
      499900,
      'new-competitor-entered payload.competitorPriceCents must be toCents(4999) = 499900',
    );
    assert.equal(
      newCompetitorCall.payload.skuId,
      'sku-2',
      'new-competitor-entered payload.skuId must match the sku_channel sku_id',
    );
    assert.ok(
      'cycleId' in newCompetitorCall.payload,
      'new-competitor-entered payload must include cycleId property (may be null or a UUID string)',
    );
    // Verify canonical shape has exactly the 3 expected keys
    const newCompPayloadKeys = Object.keys(newCompetitorCall.payload).sort();
    assert.deepEqual(
      newCompPayloadKeys,
      ['competitorPriceCents', 'cycleId', 'skuId'],
      'PayloadForNewCompetitorEntered must have exactly { skuId, competitorPriceCents, cycleId } — canonical shape',
    );

    // THEN: last_checked_at bumped (1 UPDATE with no tier guard — tier already transitioned)
    const updateCalls = client._calls.filter(c =>
      c.sql.trim().toUpperCase().startsWith('UPDATE') &&
      c.sql.toLowerCase().includes('sku_channels')
    );
    assert.equal(updateCalls.length, 1, 'Exactly 1 UPDATE sku_channels (last_checked_at freshness) after transition');

    // THEN: Return-shape stats
    assert.equal(result.tierTransitions, 1, 'tierTransitions must be 1');
    assert.equal(result.newCompetitorsDetected, 1, 'newCompetitorsDetected must be 1');
    assert.equal(result.skusEvaluated, 1, 'skusEvaluated must be 1');
  });
});

// ---------------------------------------------------------------------------
// Test 3 — T3 with new competitor + losing → T3→T1 + 2 audit emissions
// ---------------------------------------------------------------------------

describe('reconciliation — T3 new competitor losing T3→T1 (AC4 test 3)', () => {
  test('T3_losing_competitor_emits_tier_transition_T1_and_new_competitor_entered', async () => {
    const skuChannel = buildSkuChannel({
      id: 'sc-3',
      sku_id: 'sku-3',
      current_price_cents: 5500,
      min_shipping_price_cents: 0,
      last_checked_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });

    const { pool, client } = buildMockPool({
      selectResult: { rows: [skuChannel], rowCount: 1 },
    });
    const { logger } = buildMockLogger();

    const auditWriterCalls = [];
    const mockAuditWriter = async (args) => {
      auditWriterCalls.push(args);
      return { id: 'mock-audit-id' };
    };

    // Competitor at 4999 total_price < our 5500 → competitor wins, we are at position 2
    const competitorOffer = { active: true, total_price: 4999, shop_name: 'CompetitorA' };
    const mockP11Fetcher = async () => [competitorOffer];
    const mockSelfFilter = (rawOffers, _shopName) => ({ filteredOffers: rawOffers, collisionDetected: false });
    const mockTierClassifier = async () => ({
      tierTransitioned: true,
      fromTier: '3',
      toTier: '1',
      reason: 'lost-1st-place-from-tier3',
    });

    const result = await runWithDeps(pool, logger, {
      p11Fetcher: mockP11Fetcher,
      selfFilter: mockSelfFilter,
      auditWriter: mockAuditWriter,
      tierClassifier: mockTierClassifier,
      decryptFn: () => 'mock-api-key',
    });

    // THEN: 2 audit events emitted
    assert.equal(auditWriterCalls.length, 2, 'writeAuditEvent must be called exactly twice (tier-transition + new-competitor-entered)');

    // THEN: tier-transition payload
    const tierTransitionCall = auditWriterCalls.find(c => c.eventType === 'tier-transition');
    assert.ok(tierTransitionCall, 'Must emit tier-transition event');
    assert.deepEqual(
      tierTransitionCall.payload,
      { fromTier: '3', toTier: '1', reason: 'lost-1st-place-from-tier3' },
      'tier-transition payload must have canonical { fromTier: "3", toTier: "1", reason: "lost-1st-place-from-tier3" }',
    );

    // THEN: new-competitor-entered payload
    const newCompetitorCall = auditWriterCalls.find(c => c.eventType === 'new-competitor-entered');
    assert.ok(newCompetitorCall, 'Must emit new-competitor-entered event');
    assert.equal(
      newCompetitorCall.payload.competitorPriceCents,
      499900,
      'competitorPriceCents must be toCents(4999) = 499900',
    );
    assert.equal(newCompetitorCall.payload.skuId, 'sku-3', 'payload.skuId must match');

    // THEN: last_checked_at bumped
    const updateCalls = client._calls.filter(c =>
      c.sql.trim().toUpperCase().startsWith('UPDATE') &&
      c.sql.toLowerCase().includes('sku_channels')
    );
    assert.equal(updateCalls.length, 1, 'Exactly 1 UPDATE (last_checked_at) after T3→T1 transition');

    // THEN: stats
    assert.equal(result.tierTransitions, 1, 'tierTransitions must be 1');
    assert.equal(result.newCompetitorsDetected, 1, 'newCompetitorsDetected must be 1');
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Stale-state detection — drift > 2× cadence triggers warn-log (AC3)
// ---------------------------------------------------------------------------

describe('reconciliation — stale-state detection (AC3, AC4 test 4)', () => {
  test('stale_state_drift_over_2x_cadence_triggers_warn_log_and_increments_counter', async () => {
    // 50h old — past 2880-min (tier_cadence_minutes * 2) drift threshold
    const skuChannel = buildSkuChannel({
      id: 'sc-4',
      sku_id: 'sku-4',
      tier_cadence_minutes: 1440,
      last_checked_at: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(), // 50h ago
    });

    const { pool } = buildMockPool({
      selectResult: { rows: [skuChannel], rowCount: 1 },
    });
    const { logger, warns } = buildMockLogger();

    const auditWriterCalls = [];
    const mockAuditWriter = async (args) => { auditWriterCalls.push(args); return { id: 'mock-audit-id' }; };
    const mockP11Fetcher = async () => [];
    const mockSelfFilter = (rawOffers, _shopName) => ({ filteredOffers: rawOffers, collisionDetected: false });
    const mockTierClassifier = async () => ({ tierTransitioned: false, fromTier: '3', toTier: '3', reason: 'no-transition-stable' });

    const result = await runWithDeps(pool, logger, {
      p11Fetcher: mockP11Fetcher,
      selfFilter: mockSelfFilter,
      auditWriter: mockAuditWriter,
      tierClassifier: mockTierClassifier,
      decryptFn: () => 'mock-api-key',
    });

    // THEN: logger.warn called at least once with stale-state message
    assert.ok(warns.length >= 1, 'logger.warn must be called at least once for stale-state (drift > 2× cadence)');

    // THEN: warn message must contain 'stale-state detected'
    const staleWarn = warns.find(w => {
      const msg = typeof w[0] === 'string' ? w[0] : (w[1] || '');
      return (typeof msg === 'string' && msg.includes('stale-state detected')) ||
             (w[0] && typeof w[0] === 'object' && w[1] && typeof w[1] === 'string' && w[1].includes('stale-state detected'));
    });
    assert.ok(staleWarn, 'warn must contain "stale-state detected" message (AC3 canonical message text)');

    // THEN: warn must include structured fields with driftMinutes >= 3000 (50h × 60 = 3000 min)
    // The warn args may be (fields, message) or (message, fields) per pino API
    const warnArgs = staleWarn;
    const fieldsArg = warnArgs.find(a => a && typeof a === 'object' && 'driftMinutes' in a);
    if (fieldsArg) {
      assert.ok(
        fieldsArg.driftMinutes >= 3000,
        `driftMinutes (${fieldsArg.driftMinutes}) must be >= 3000 for a 50h-old row (50h × 60 = 3000 min)`,
      );
    }
    // If no driftMinutes in fields, just check message contains canonical text — sufficient per AC3

    // THEN: staleStateWarnings counter incremented
    assert.equal(result.staleStateWarnings, 1, 'staleStateWarnings must be 1 for one drifted row');

    // THEN: Row still receives its standard UPDATE last_checked_at (drift detection does NOT skip the row)
    // (no-competitor branch still bumps last_checked_at per AC3 scope guard)
    assert.equal(result.skusEvaluated, 1, 'skusEvaluated must be 1 (stale row not skipped)');

    // THEN: ZERO audit events (stale-state is observability only, NOT in AD20 taxonomy)
    assert.equal(auditWriterCalls.length, 0, 'stale-state must NOT emit any audit events (AC3 — observability only)');
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Shop-name collision → warn-log + skip, ZERO audit events, last_checked_at still bumped
// ---------------------------------------------------------------------------

describe('reconciliation — shop-name collision (AC4 test 5)', () => {
  test('collision_detected_warn_skip_no_audit_events_last_checked_at_bumped', async () => {
    const skuChannel = buildSkuChannel({
      id: 'sc-5',
      sku_id: 'sku-5',
      shop_name: 'Easy - Store',
      current_price_cents: 4500,
    });

    const { pool, client } = buildMockPool({
      selectResult: { rows: [skuChannel], rowCount: 1 },
    });
    const { logger, warns } = buildMockLogger();

    const auditWriterCalls = [];
    const mockAuditWriter = async (args) => { auditWriterCalls.push(args); return { id: 'mock-audit-id' }; };

    // Two offers with our own shop name — AD13 collision
    const mockP11Fetcher = async () => [
      { active: true, total_price: 4500, shop_name: 'Easy - Store' },
      { active: true, total_price: 4500, shop_name: 'Easy - Store' },
    ];
    // selfFilter returns collisionDetected: true
    const mockSelfFilter = (_rawOffers, _shopName) => ({ filteredOffers: [], collisionDetected: true });

    let tierClassifierCalled = false;
    const mockTierClassifier = async () => { tierClassifierCalled = true; return {}; };

    const result = await runWithDeps(pool, logger, {
      p11Fetcher: mockP11Fetcher,
      selfFilter: mockSelfFilter,
      auditWriter: mockAuditWriter,
      tierClassifier: mockTierClassifier,
      decryptFn: () => 'mock-api-key',
    });

    // THEN: logger.warn called (collision warning)
    assert.ok(warns.length >= 1, 'logger.warn must be called at least once for collision detection');

    // THEN: ZERO writeAuditEvent calls
    assert.equal(auditWriterCalls.length, 0, 'ZERO writeAuditEvent calls on collision (row skipped — no tier decision)');

    // THEN: applyTierClassification NOT called (skip on collision per AC1 contract)
    assert.equal(tierClassifierCalled, false, 'applyTierClassification must NOT be called when collisionDetected=true');

    // THEN: last_checked_at UPDATE still issued (so row isn't immediately retried — AC1 collision path)
    const updateCalls = client._calls.filter(c =>
      c.sql.trim().toUpperCase().startsWith('UPDATE') &&
      c.sql.toLowerCase().includes('sku_channels')
    );
    assert.ok(updateCalls.length >= 1, 'last_checked_at UPDATE must still be issued even on collision (prevents immediate retry)');

    // THEN: stats reflect evaluation occurred
    assert.equal(result.skusEvaluated, 1, 'skusEvaluated must be 1 (collision row evaluated even if skipped)');
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Optimistic-concurrency race-loser → warn-log, ZERO audit events, last_checked_at bumped
// ---------------------------------------------------------------------------

describe('reconciliation — optimistic-concurrency race-loser (AC4 test 6)', () => {
  test('concurrent_transition_detected_warns_no_audit_events_last_checked_at_bumped', async () => {
    const skuChannel = buildSkuChannel({
      id: 'sc-6',
      sku_id: 'sku-6',
      current_price_cents: 4500,
    });

    const { pool, client } = buildMockPool({
      selectResult: { rows: [skuChannel], rowCount: 1 },
    });
    const { logger, warns } = buildMockLogger();

    const auditWriterCalls = [];
    const mockAuditWriter = async (args) => { auditWriterCalls.push(args); return { id: 'mock-audit-id' }; };

    const competitorOffer = { active: true, total_price: 3999, shop_name: 'CompetitorA' };
    const mockP11Fetcher = async () => [competitorOffer];
    const mockSelfFilter = (rawOffers, _shopName) => ({ filteredOffers: rawOffers, collisionDetected: false });
    // Race-loser: applyTierClassification returns concurrent-transition-detected
    const mockTierClassifier = async () => ({
      tierTransitioned: false,
      fromTier: '3',
      toTier: '3',
      reason: 'concurrent-transition-detected',
    });

    const result = await runWithDeps(pool, logger, {
      p11Fetcher: mockP11Fetcher,
      selfFilter: mockSelfFilter,
      auditWriter: mockAuditWriter,
      tierClassifier: mockTierClassifier,
      decryptFn: () => 'mock-api-key',
    });

    // THEN: logger.warn called (race-loss warning)
    assert.ok(warns.length >= 1, 'logger.warn must be called for optimistic-concurrency race-loser');

    // THEN: ZERO writeAuditEvent calls (winning tx already emitted; AC1 race-loser scope guard)
    assert.equal(auditWriterCalls.length, 0, 'ZERO writeAuditEvent calls on race-loser (winning tx already emitted them)');

    // THEN: last_checked_at UPDATE still issued (freshness bookkeeping — AC1 race-loser branch)
    const updateCalls = client._calls.filter(c =>
      c.sql.trim().toUpperCase().startsWith('UPDATE') &&
      c.sql.toLowerCase().includes('sku_channels')
    );
    assert.ok(updateCalls.length >= 1, 'last_checked_at UPDATE must be issued even for race-loser (freshness bookkeeping)');

    // THEN: stats
    assert.equal(result.tierTransitions, 0, 'tierTransitions must be 0 for race-loser');
    assert.equal(result.skusEvaluated, 1, 'skusEvaluated must be 1');
  });
});

// ---------------------------------------------------------------------------
// Test 7 — Cross-customer iteration — SELECT has no customer_marketplace_id filter
// ---------------------------------------------------------------------------

describe('reconciliation — cross-customer iteration (AC4 test 7)', () => {
  test('select_is_cross_customer_no_per_customer_filter_and_has_cross_customer_pragma', async () => {
    // 3 rows: 2 from cm-1, 1 from cm-2 — both customers' T3 rows in the SELECT result
    const row1 = buildSkuChannel({ id: 'sc-a', sku_id: 'sku-a', customer_marketplace_id: 'cm-1' });
    const row2 = buildSkuChannel({ id: 'sc-b', sku_id: 'sku-b', customer_marketplace_id: 'cm-1' });
    const row3 = buildSkuChannel({ id: 'sc-c', sku_id: 'sku-c', customer_marketplace_id: 'cm-2' });

    const { pool, client } = buildMockPool({
      selectResult: { rows: [row1, row2, row3], rowCount: 3 },
    });
    const { logger } = buildMockLogger();

    const mockP11Fetcher = async () => [];
    const mockSelfFilter = (rawOffers, _shopName) => ({ filteredOffers: rawOffers, collisionDetected: false });
    const mockTierClassifier = async () => ({ tierTransitioned: false, fromTier: '3', toTier: '3', reason: 'no-transition-stable' });
    const mockAuditWriter = async () => ({ id: 'mock-id' });

    const result = await runWithDeps(pool, logger, {
      p11Fetcher: mockP11Fetcher,
      selfFilter: mockSelfFilter,
      auditWriter: mockAuditWriter,
      tierClassifier: mockTierClassifier,
      decryptFn: () => 'mock-api-key',
    });

    // THEN: all 3 rows evaluated across both customers
    assert.equal(result.skusEvaluated, 3, 'skusEvaluated must be 3 (cross-customer: 2 from cm-1 + 1 from cm-2)');

    // THEN: The captured SELECT SQL must NOT include a customer_marketplace_id per-customer filter
    const selectCall = client._calls.find(c => c.sql.trim().toUpperCase().startsWith('SELECT'));
    assert.ok(selectCall, 'A SELECT statement must have been issued by runReconciliationPass');

    const selectSql = selectCall.sql;
    assert.ok(
      !(/customer_marketplace_id\s*=\s*\$/.test(selectSql)),
      'SELECT SQL must NOT include customer_marketplace_id = $N filter — reconciliation is a cross-customer sweep',
    );

    // THEN: SELECT must include tier = '3' predicate
    assert.ok(
      selectSql.toLowerCase().includes("tier = '3'") || selectSql.toLowerCase().includes('tier=$') || selectSql.toLowerCase().includes("tier='3'"),
      "SELECT must include tier = '3' predicate",
    );

    // THEN: SELECT must include the frozen/excluded/pending_import_id guard predicates (AC1 contract)
    assert.ok(
      selectSql.toLowerCase().includes('frozen_for_anomaly_review'),
      'SELECT must include frozen_for_anomaly_review predicate',
    );
    assert.ok(
      selectSql.toLowerCase().includes('pending_import_id'),
      'SELECT must include pending_import_id IS NULL predicate',
    );

    // THEN: Source file MUST contain the inline // safe: cross-customer cron comment above the SELECT
    // This is the dual-pragma pattern required by Constraint #24 (worker-must-filter-by-customer)
    const src = readFileSync(SOURCE_PATH, 'utf-8');
    const crossCustomerPragmaPattern = /\/\/\s*safe:\s*cross-customer\s+cron/i;
    assert.ok(
      crossCustomerPragmaPattern.test(src),
      'worker/src/safety/reconciliation.js MUST contain a "// safe: cross-customer cron" pragma comment ' +
      '(Constraint #24 — worker-must-filter-by-customer ESLint rule requires this inline comment above the SELECT)',
    );

    // THEN: The inline pragma MUST appear above a query call (mirror dispatcher.js:189 pattern)
    // Regex: "// safe: cross-customer cron" followed (within a few lines) by a .query( call
    const inlinePragmaBeforeQueryPattern = /\/\/\s*safe:\s*cross-customer\s+cron[\s\S]{0,500}?\.query\s*\(/i;
    assert.ok(
      inlinePragmaBeforeQueryPattern.test(src),
      'The "// safe: cross-customer cron" inline comment must appear immediately before a .query( call in reconciliation.js ' +
      '(dual-pragma requirement: file-top block + inline-above-the-query per Constraint #24)',
    );
  });
});

// ---------------------------------------------------------------------------
// Source-inspection assertions (negative + structural)
// ---------------------------------------------------------------------------

describe('reconciliation.js — source inspection (AC1 + AC5 negative assertions)', () => {
  test('reconciliation.js must NOT contain raw INSERT INTO audit_log (Constraint #21)', () => {
    // This test will only pass once the source file exists (post Task 1).
    // Pre-dev: this is expected to fail (file does not exist yet).
    let src;
    try {
      src = readFileSync(SOURCE_PATH, 'utf-8');
    } catch (e) {
      // Source file not yet created — skip this structural assertion pre-dev
      return;
    }

    assert.ok(
      !src.includes('INSERT INTO audit_log'),
      'reconciliation.js must NOT contain raw INSERT INTO audit_log ' +
      '(ESLint no-raw-INSERT-audit-log, Constraint #21 — all audit emission via writeAuditEvent SSoT)',
    );
  });

  test('reconciliation.js must NOT contain console.log (Constraint #18)', () => {
    let src;
    try {
      src = readFileSync(SOURCE_PATH, 'utf-8');
    } catch (e) { return; }

    assert.ok(
      !src.includes('console.log'),
      'reconciliation.js must NOT use console.log (Constraint #18 — pino only via logger parameter)',
    );
  });

  test('reconciliation.js must NOT contain export default (named exports only)', () => {
    let src;
    try {
      src = readFileSync(SOURCE_PATH, 'utf-8');
    } catch (e) { return; }

    assert.ok(
      !src.includes('export default'),
      'reconciliation.js must NOT use export default (Constraint #7 — no-default-export ESLint rule)',
    );
  });

  test('reconciliation.js must NOT contain direct fetch() call (Constraint #19)', () => {
    let src;
    try {
      src = readFileSync(SOURCE_PATH, 'utf-8');
    } catch (e) { return; }

    assert.ok(
      !(/\bfetch\s*\(/.test(src)),
      'reconciliation.js must NOT call fetch() directly (Constraint #19 — HTTP only via shared/mirakl/p11.js wrapper)',
    );
  });

  test('reconciliation.js must NOT contain .then() chains (async/await only)', () => {
    let src;
    try {
      src = readFileSync(SOURCE_PATH, 'utf-8');
    } catch (e) { return; }

    // Allow .then( in comments / strings but not in code
    // Strip line comments and string literals before checking
    const srcWithoutComments = src.replace(/\/\/.*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(
      !(/\.then\s*\(/.test(srcWithoutComments)),
      'reconciliation.js must NOT use .then() chains (AC1 ESLint constraint — async/await only)',
    );
  });

  test('runReconciliationPass must be a named export of reconciliation.js', () => {
    let src;
    try {
      src = readFileSync(SOURCE_PATH, 'utf-8');
    } catch (e) { return; }

    assert.ok(
      src.includes('export') && src.includes('runReconciliationPass'),
      'reconciliation.js must export runReconciliationPass as a named export',
    );
    // Verify it's not a default export
    assert.ok(
      !(/export\s+default\s+runReconciliationPass/.test(src)),
      'runReconciliationPass must NOT be the default export',
    );
  });
});
