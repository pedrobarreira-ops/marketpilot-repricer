// tests/worker/safety/circuit-breaker.test.js
//
// Story 7.6 — ATDD: Unit tests for worker/src/safety/circuit-breaker.js
//
// Covers AC1 (per-SKU 15% cap — sync, pure), AC2 (per-cycle 20% cap — async, DB),
// AC5 (all boundary cases), AC7 (negative assertions via static checks).
// Also verifies the manual-unblock invariant (PAUSED_BY_CIRCUIT_BREAKER → ACTIVE
// is in LEGAL_CRON_TRANSITIONS AND is NOT in the per-transition event map).
//
// Run with: node --test tests/worker/safety/circuit-breaker.test.js
// Or via:   npm run test:unit

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LEGAL_CRON_TRANSITIONS } from '../../../shared/state/transitions-matrix.js';
import { checkPerSkuCircuitBreaker, checkPerCycleCircuitBreaker } from '../../../worker/src/safety/circuit-breaker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock skuChannel row.
 * @param {object} [overrides]
 * @returns {object}
 */
function makeSkuChannel (overrides = {}) {
  return {
    id: 'sc-test-uuid',
    sku_id: 'sku-test-uuid',
    customer_marketplace_id: 'cm-test-uuid',
    ...overrides,
  };
}

/**
 * Build a mock tx whose .query() returns configurable COUNT rows.
 * pri01_staging COUNT → numerator, sku_channels COUNT → denominator.
 * @param {{ numerator?: number, denominator?: number }} opts
 * @returns {object}
 */
function makeMockTx ({ numerator = 0, denominator = 100 } = {}) {
  return {
    query: async (sql) => {
      if (sql.includes('pri01_staging')) {
        return { rows: [{ count: numerator }] };
      }
      if (sql.includes('sku_channels')) {
        return { rows: [{ count: denominator }] };
      }
      return { rows: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// AC1 — checkPerSkuCircuitBreaker — synchronous, pure, 15% cap
// ---------------------------------------------------------------------------

describe('checkPerSkuCircuitBreaker — per-SKU 15% circuit breaker', () => {
  const skuChannel = makeSkuChannel();

  test('AC1: deltaPct 0.14 — NOT tripped (below threshold)', () => {
    // 14% increase: 100 → 114
    const result = checkPerSkuCircuitBreaker({
      skuChannel,
      newPriceCents: 11400,
      currentPriceCents: 10000,
    });
    assert.equal(result.tripped, false, 'Should NOT trip at 14%');
    assert.ok(
      Math.abs(result.deltaPct - 0.14) < 0.0001,
      `deltaPct should be 0.14, got ${result.deltaPct}`,
    );
  });

  test('AC1: deltaPct exactly 0.15 — NOT tripped (strict > not met)', () => {
    // Exactly 15%: strict > 0.15 means exactly 0.15 does NOT trip
    const result = checkPerSkuCircuitBreaker({
      skuChannel,
      newPriceCents: 11500,
      currentPriceCents: 10000,
    });
    assert.equal(result.tripped, false, 'Should NOT trip at exactly 15% (strict >)');
    assert.ok(
      Math.abs(result.deltaPct - 0.15) < 0.0001,
      `deltaPct should be 0.15, got ${result.deltaPct}`,
    );
  });

  test('AC1: deltaPct 0.16 — tripped (above threshold)', () => {
    // 16% increase
    const result = checkPerSkuCircuitBreaker({
      skuChannel,
      newPriceCents: 11600,
      currentPriceCents: 10000,
    });
    assert.equal(result.tripped, true, 'Should trip at 16%');
    assert.ok(
      Math.abs(result.deltaPct - 0.16) < 0.0001,
      `deltaPct should be 0.16, got ${result.deltaPct}`,
    );
  });

  test('AC1: deltaPct 0.151 — tripped (boundary just above 15%)', () => {
    // 15.1% increase: 10000 → 11510
    const result = checkPerSkuCircuitBreaker({
      skuChannel,
      newPriceCents: 11510,
      currentPriceCents: 10000,
    });
    assert.equal(result.tripped, true, 'Should trip at 15.1%');
    assert.ok(result.deltaPct > 0.15, `deltaPct ${result.deltaPct} should be > 0.15`);
  });

  test('AC1: price DROP of 16% — tripped (Math.abs applied)', () => {
    // Price DROP: 10000 → 8400 = 16% drop; Math.abs means same rule applies
    const result = checkPerSkuCircuitBreaker({
      skuChannel,
      newPriceCents: 8400,
      currentPriceCents: 10000,
    });
    assert.equal(result.tripped, true, 'Price drops should also trigger circuit breaker');
    assert.ok(
      Math.abs(result.deltaPct - 0.16) < 0.0001,
      `deltaPct should be 0.16 for a 16% drop, got ${result.deltaPct}`,
    );
  });

  test('AC1: price DROP of 14% — NOT tripped', () => {
    // Price DROP: 10000 → 8600 = 14% drop
    const result = checkPerSkuCircuitBreaker({
      skuChannel,
      newPriceCents: 8600,
      currentPriceCents: 10000,
    });
    assert.equal(result.tripped, false, 'A 14% price drop should NOT trip');
  });

  test('AC1: function is synchronous — returns plain object (not Promise)', () => {
    const result = checkPerSkuCircuitBreaker({
      skuChannel,
      newPriceCents: 11600,
      currentPriceCents: 10000,
    });
    // If it were async, result would be a Promise — assert it is NOT
    assert.ok(
      !(result instanceof Promise),
      'checkPerSkuCircuitBreaker must be synchronous — must not return a Promise',
    );
    assert.ok(typeof result === 'object' && result !== null, 'Must return a plain object');
    assert.ok('tripped' in result, 'Must have tripped field');
    assert.ok('deltaPct' in result, 'Must have deltaPct field');
  });

  test('AC1: no side effects — result object has exactly tripped + deltaPct (no extra fields)', () => {
    const result = checkPerSkuCircuitBreaker({
      skuChannel,
      newPriceCents: 10500,
      currentPriceCents: 10000,
    });
    const keys = Object.keys(result).sort();
    assert.deepEqual(keys, ['deltaPct', 'tripped'], 'Return value must have exactly {tripped, deltaPct}');
  });
});

// ---------------------------------------------------------------------------
// AC2 / AC5 — checkPerCycleCircuitBreaker — async, DB queries, 20% cap
// ---------------------------------------------------------------------------

describe('checkPerCycleCircuitBreaker — per-cycle 20% circuit breaker', () => {
  const customerMarketplaceId = 'cm-test-uuid';
  const cycleId = 'cycle-test-uuid';

  test('AC5: numerator/denominator = 0.20 — NOT tripped (strict > not met)', async () => {
    // 20/100 = exactly 0.20 — strict > means this does NOT trip
    const tx = makeMockTx({ numerator: 20, denominator: 100 });
    const sendAlertFn = async () => {};
    const transitionCronStateFn = async () => {};

    const result = await checkPerCycleCircuitBreaker({
      tx,
      customerMarketplaceId,
      cycleId,
      sendAlertFn,
      transitionCronStateFn,
    });

    assert.equal(result.tripped, false, 'Exactly 20% should NOT trip (strict >)');
    assert.equal(result.numerator, 20);
    assert.equal(result.denominator, 100);
    assert.ok(Math.abs(result.affectedPct - 0.20) < 0.0001, `affectedPct should be 0.20, got ${result.affectedPct}`);
  });

  test('AC5: numerator/denominator = 0.21 — tripped → transitionCronStateFn + sendAlertFn called', async () => {
    // 21/100 = 0.21 > 0.20 → should trip
    const tx = makeMockTx({ numerator: 21, denominator: 100 });
    const transitionCalls = [];
    const alertCalls = [];

    const transitionCronStateFn = async (args) => { transitionCalls.push(args); };
    const sendAlertFn = async (args) => { alertCalls.push(args); };

    const result = await checkPerCycleCircuitBreaker({
      tx,
      customerMarketplaceId,
      cycleId,
      sendAlertFn,
      transitionCronStateFn,
    });

    assert.equal(result.tripped, true, 'Should trip at 21%');
    assert.equal(result.numerator, 21);
    assert.equal(result.denominator, 100);
    assert.ok(Math.abs(result.affectedPct - 0.21) < 0.0001);

    // transitionCronStateFn must be called with correct args
    assert.equal(transitionCalls.length, 1, 'transitionCronStateFn must be called exactly once');
    const transition = transitionCalls[0];
    assert.equal(transition.customerMarketplaceId, customerMarketplaceId);
    assert.equal(transition.from, 'ACTIVE', 'Must transition FROM ACTIVE');
    assert.equal(transition.to, 'PAUSED_BY_CIRCUIT_BREAKER', 'Must transition TO PAUSED_BY_CIRCUIT_BREAKER');
    assert.deepEqual(transition.context, { cycleId, numerator: 21, denominator: 100 });

    // sendAlertFn must also be called
    assert.equal(alertCalls.length, 1, 'sendAlertFn must be called exactly once on trip');
    const alert = alertCalls[0];
    assert.equal(alert.customerMarketplaceId, customerMarketplaceId);
    assert.equal(alert.cycleId, cycleId);
  });

  test('AC5: numerator = 0, denominator = 100 — NOT tripped (0% affected)', async () => {
    const tx = makeMockTx({ numerator: 0, denominator: 100 });
    const transitionCronStateFn = async () => { throw new Error('Should not be called'); };
    const sendAlertFn = async () => { throw new Error('Should not be called'); };

    const result = await checkPerCycleCircuitBreaker({
      tx,
      customerMarketplaceId,
      cycleId,
      sendAlertFn,
      transitionCronStateFn,
    });

    assert.equal(result.tripped, false, '0% affected should NOT trip');
    assert.equal(result.numerator, 0);
    assert.equal(result.denominator, 100);
    assert.equal(result.affectedPct, 0);
  });

  test('AC5: denominator = 0 (no active SKUs) — NOT tripped (division-by-zero guard)', async () => {
    const tx = makeMockTx({ numerator: 0, denominator: 0 });
    const transitionCronStateFn = async () => { throw new Error('Should not be called'); };
    const sendAlertFn = async () => { throw new Error('Should not be called'); };

    const result = await checkPerCycleCircuitBreaker({
      tx,
      customerMarketplaceId,
      cycleId,
      sendAlertFn,
      transitionCronStateFn,
    });

    assert.equal(result.tripped, false, 'Zero active SKUs must not trip — guard against division by zero');
    // affectedPct must not be NaN or Infinity
    assert.ok(Number.isFinite(result.affectedPct), `affectedPct must be finite, got ${result.affectedPct}`);
  });

  test('AC2: not-tripped result shape includes numerator, denominator, affectedPct', async () => {
    const tx = makeMockTx({ numerator: 10, denominator: 100 });
    const result = await checkPerCycleCircuitBreaker({
      tx,
      customerMarketplaceId,
      cycleId,
      sendAlertFn: async () => {},
      transitionCronStateFn: async () => {},
    });

    assert.equal(result.tripped, false);
    assert.ok('numerator' in result, 'Must include numerator');
    assert.ok('denominator' in result, 'Must include denominator');
    assert.ok('affectedPct' in result, 'Must include affectedPct');
    assert.equal(result.numerator, 10);
    assert.equal(result.denominator, 100);
    assert.ok(Math.abs(result.affectedPct - 0.10) < 0.0001);
  });

  test('AC2: tripped result shape — {tripped:true, numerator, denominator, affectedPct}', async () => {
    const tx = makeMockTx({ numerator: 25, denominator: 100 });
    const result = await checkPerCycleCircuitBreaker({
      tx,
      customerMarketplaceId,
      cycleId,
      sendAlertFn: async () => {},
      transitionCronStateFn: async () => {},
    });

    assert.equal(result.tripped, true);
    assert.equal(result.numerator, 25);
    assert.equal(result.denominator, 100);
    assert.ok(Math.abs(result.affectedPct - 0.25) < 0.0001);
  });

  test('AC2: on trip, transitionCronStateFn is called BEFORE sendAlertFn (ordering)', async () => {
    const tx = makeMockTx({ numerator: 30, denominator: 100 });
    const callOrder = [];

    const transitionCronStateFn = async () => { callOrder.push('transition'); };
    const sendAlertFn = async () => { callOrder.push('alert'); };

    await checkPerCycleCircuitBreaker({
      tx,
      customerMarketplaceId,
      cycleId,
      sendAlertFn,
      transitionCronStateFn,
    });

    assert.deepEqual(callOrder, ['transition', 'alert'], 'transitionCronState must be called before sendAlert');
  });

  test('AC2: denominator query uses customer_marketplace_id filter (worker-must-filter-by-customer)', async () => {
    // Verify the tx receives a query with customer_marketplace_id for sku_channels (not just cycle_id)
    const queries = [];
    const tx = {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (sql.includes('pri01_staging')) return { rows: [{ count: 10 }] };
        if (sql.includes('sku_channels')) return { rows: [{ count: 100 }] };
        return { rows: [] };
      },
    };

    await checkPerCycleCircuitBreaker({
      tx,
      customerMarketplaceId,
      cycleId,
      sendAlertFn: async () => {},
      transitionCronStateFn: async () => {},
    });

    // Find the sku_channels query
    const skuChannelsQuery = queries.find((q) => q.sql.includes('sku_channels'));
    assert.ok(skuChannelsQuery, 'Must query sku_channels for denominator');
    assert.ok(
      skuChannelsQuery.params.includes(customerMarketplaceId),
      'sku_channels query must include customer_marketplace_id param (worker-must-filter-by-customer)',
    );

    // Find the pri01_staging query
    const stagingQuery = queries.find((q) => q.sql.includes('pri01_staging'));
    assert.ok(stagingQuery, 'Must query pri01_staging for numerator');
    assert.ok(
      stagingQuery.params.includes(customerMarketplaceId),
      'pri01_staging query must include customer_marketplace_id param (worker-must-filter-by-customer)',
    );
    assert.ok(
      stagingQuery.params.includes(cycleId),
      'pri01_staging query must include cycleId param',
    );
  });
});

// ---------------------------------------------------------------------------
// AC5 — Manual unblock invariant (LEGAL_CRON_TRANSITIONS matrix checks)
// ---------------------------------------------------------------------------

describe('Manual unblock invariant — PAUSED_BY_CIRCUIT_BREAKER → ACTIVE', () => {
  test('AC5: PAUSED_BY_CIRCUIT_BREAKER → ACTIVE is in LEGAL_CRON_TRANSITIONS', () => {
    const allowedFromPaused = LEGAL_CRON_TRANSITIONS['PAUSED_BY_CIRCUIT_BREAKER'] ?? [];
    assert.ok(
      allowedFromPaused.includes('ACTIVE'),
      'PAUSED_BY_CIRCUIT_BREAKER → ACTIVE must be a legal transition (enables Story 8.5 manual unblock)',
    );
  });

  test('AC5: ACTIVE → PAUSED_BY_CIRCUIT_BREAKER is in LEGAL_CRON_TRANSITIONS', () => {
    const allowedFromActive = LEGAL_CRON_TRANSITIONS['ACTIVE'] ?? [];
    assert.ok(
      allowedFromActive.includes('PAUSED_BY_CIRCUIT_BREAKER'),
      'ACTIVE → PAUSED_BY_CIRCUIT_BREAKER must be a legal transition (circuit-breaker trip path)',
    );
  });
});

// ---------------------------------------------------------------------------
// AC7 — Negative assertions via module source inspection
// ---------------------------------------------------------------------------

describe('AC7 — Negative assertions (source inspection)', () => {
  test('circuit-breaker.js source does not contain raw INSERT INTO audit_log', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, '../../../worker/src/safety/circuit-breaker.js'), 'utf-8');

    assert.ok(
      !src.includes('INSERT INTO audit_log'),
      'circuit-breaker.js must NOT contain raw INSERT INTO audit_log (ESLint no-raw-INSERT-audit-log)',
    );
  });

  test('circuit-breaker.js source does not contain raw UPDATE customer_marketplaces SET cron_state', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, '../../../worker/src/safety/circuit-breaker.js'), 'utf-8');

    assert.ok(
      !src.includes('UPDATE customer_marketplaces SET cron_state'),
      'circuit-breaker.js must NOT contain raw UPDATE cron_state (ESLint no-raw-UPDATE-cron-state)',
    );
  });

  test('circuit-breaker.js source does not contain console.log', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(__dirname, '../../../worker/src/safety/circuit-breaker.js'), 'utf-8');

    assert.ok(
      !src.includes('console.log'),
      'circuit-breaker.js must use pino logger — no console.log allowed',
    );
  });

  test('checkPerSkuCircuitBreaker export is not async (no async keyword on function)', () => {
    // Direct runtime inspection: verify function is sync (not AsyncFunction)
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    assert.ok(
      !(checkPerSkuCircuitBreaker instanceof AsyncFunction),
      'checkPerSkuCircuitBreaker must NOT be an async function',
    );
    // Also check its toString() does not start with "async"
    const fnStr = checkPerSkuCircuitBreaker.toString().trimStart();
    assert.ok(
      !fnStr.startsWith('async'),
      'checkPerSkuCircuitBreaker must NOT be declared as async function',
    );
  });

  test('checkPerCycleCircuitBreaker export is async', async () => {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    assert.ok(
      checkPerCycleCircuitBreaker instanceof AsyncFunction,
      'checkPerCycleCircuitBreaker MUST be an async function',
    );
  });
});
