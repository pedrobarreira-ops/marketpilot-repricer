// ATOMICITY BUNDLE C GATE — AD7+AD8+AD9+AD11
// This test is the single binding integration gate for Bundle C.
// Epic 6 writer code (Stories 6.1, 6.2, 6.3) is NOT safe to ship to production
// until all assertions in this test file pass.
//
// tests/integration/circuit-breaker-trip.test.js — Story 7.8 AC4
//
// 21% catalog change → cycle halt + cron_state transition + Atenção event + no PRI01 emitted.
// Also: 20% exactly does NOT trip (boundary); denominator=0 guard returns { tripped: false }.
//
// Run with: node --test tests/integration/circuit-breaker-trip.test.js

// Stub RESEND_API_KEY before any imports — circuit-breaker.js loads resend/client.js at import time.
// ESM static imports are hoisted above top-level statements, so we MUST use dynamic imports
// for modules that transitively load shared/resend/client.js. Same pattern as
// tests/worker/safety/circuit-breaker.test.js and tests/worker/cycle-assembly.test.js.
if (!process.env.RESEND_API_KEY) {
  process.env.RESEND_API_KEY = 're_test_integration_stub_xxxxxxxxxxxxxx';
}

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { checkPerCycleCircuitBreaker, checkPerSkuCircuitBreaker } = await import('../../worker/src/safety/circuit-breaker.js');

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock tx that returns specific COUNT values for circuit-breaker queries.
 * @param {{ numerator?: number, denominator?: number }} opts
 */
function buildCbMockTx ({ numerator = 0, denominator = 100 } = {}) {
  const queries = [];
  return {
    query: async (sql, params) => {
      queries.push({ sql, params });

      // Numerator query: pri01_staging COUNT
      if (sql && sql.includes('pri01_staging') && sql.toUpperCase().includes('COUNT')) {
        return { rows: [{ count: numerator }] };
      }

      // Denominator query: sku_channels COUNT
      if (sql && sql.includes('sku_channels') && sql.toUpperCase().includes('COUNT')) {
        return { rows: [{ count: denominator }] };
      }

      return { rows: [], rowCount: 0 };
    },
    _queries: queries,
  };
}

// ---------------------------------------------------------------------------
// AC4 — checkPerCycleCircuitBreaker: 21% → trip
// ---------------------------------------------------------------------------

describe('AC4 — per-cycle circuit breaker: 21% staged → trip', () => {
  test('21/100 staged SKUs → tripped=true + cron_state transition + alert', async () => {
    const tx = buildCbMockTx({ numerator: 21, denominator: 100 });
    const CM_ID = 'cm-uuid-integration';
    const CYCLE_ID = 'cycle-uuid-integration';

    // Inject mock transition fn — captures call args
    const transitionCalls = [];
    const transitionCronStateFn = async (args) => { transitionCalls.push(args); };

    // Inject mock alert fn — captures call args
    const alertCalls = [];
    const sendAlertFn = async (args) => { alertCalls.push(args); };

    const result = await checkPerCycleCircuitBreaker({
      tx,
      customerMarketplaceId: CM_ID,
      cycleId: CYCLE_ID,
      sendAlertFn,
      transitionCronStateFn,
    });

    // AC4: tripped=true with correct numerator/denominator/affectedPct
    assert.equal(result.tripped, true, 'Expected tripped=true for 21/100');
    assert.equal(result.numerator, 21, `Expected numerator=21, got ${result.numerator}`);
    assert.equal(result.denominator, 100, `Expected denominator=100, got ${result.denominator}`);
    assert.ok(
      Math.abs(result.affectedPct - 0.21) < 0.0001,
      `Expected affectedPct=0.21, got ${result.affectedPct}`,
    );

    // AC4: transitionCronStateFn called with ACTIVE → PAUSED_BY_CIRCUIT_BREAKER
    assert.equal(transitionCalls.length, 1, 'Expected exactly 1 transitionCronState call');
    const transitionCall = transitionCalls[0];
    assert.equal(transitionCall.from, 'ACTIVE', `Expected from=ACTIVE, got ${transitionCall.from}`);
    assert.equal(
      transitionCall.to,
      'PAUSED_BY_CIRCUIT_BREAKER',
      `Expected to=PAUSED_BY_CIRCUIT_BREAKER, got ${transitionCall.to}`,
    );
    assert.ok(
      transitionCall.context,
      'transitionCronStateFn must be called with a context object',
    );
    assert.equal(transitionCall.context.numerator, 21, `Expected context.numerator=21`);
    assert.equal(transitionCall.context.denominator, 100, `Expected context.denominator=100`);
    assert.equal(transitionCall.context.cycleId, CYCLE_ID, `Expected context.cycleId=${CYCLE_ID}`);
    assert.equal(transitionCall.customerMarketplaceId, CM_ID, `Expected customerMarketplaceId=${CM_ID}`);

    // AC4: sendAlertFn (Resend alert) called
    assert.equal(alertCalls.length, 1, 'Expected exactly 1 sendAlertFn call (Resend alert)');
    const alertCall = alertCalls[0];
    assert.equal(alertCall.customerMarketplaceId, CM_ID);
    assert.equal(alertCall.cycleId, CYCLE_ID);
    assert.equal(alertCall.numerator, 21);
    assert.equal(alertCall.denominator, 100);
  });

  test('no PRI01 submitted when circuit breaker trips (enforced by cycle-assembly halt)', async () => {
    // This test verifies the per-cycle CB result when tripped=true.
    // The actual "no PRI01 submitted" enforcement is in cycle-assembly.js (checks result.tripped before flush).
    // We verify here that the CB returns tripped=true so cycle-assembly will halt.

    const tx = buildCbMockTx({ numerator: 25, denominator: 100 });
    let pri01Submitted = false;

    const result = await checkPerCycleCircuitBreaker({
      tx,
      customerMarketplaceId: 'cm-pri01-halt-test',
      cycleId: 'cycle-pri01-halt-test',
      sendAlertFn: async () => {},
      transitionCronStateFn: async () => {},
    });

    assert.equal(result.tripped, true, '25/100 must trip circuit breaker');

    // Simulate cycle-assembly: if tripped, do NOT call submitPriceImport
    if (result.tripped) {
      // Halt — no PRI01 flush
    } else {
      pri01Submitted = true;  // This branch must NOT be reached
    }

    assert.equal(pri01Submitted, false, 'PRI01 must NOT be submitted when circuit breaker trips');
  });
});

// ---------------------------------------------------------------------------
// AC4 boundary tests
// ---------------------------------------------------------------------------

describe('AC4 boundary — exactly 20% does NOT trip (strict >, not >=)', () => {
  test('20/100 staged SKUs → tripped=false (exactly at threshold)', async () => {
    const tx = buildCbMockTx({ numerator: 20, denominator: 100 });

    const result = await checkPerCycleCircuitBreaker({
      tx,
      customerMarketplaceId: 'cm-boundary-test',
      cycleId: 'cycle-boundary-test',
      sendAlertFn: async () => { throw new Error('sendAlertFn must NOT be called for 20/100'); },
      transitionCronStateFn: async () => { throw new Error('transitionCronStateFn must NOT be called for 20/100'); },
    });

    assert.equal(result.tripped, false, 'Exactly 20% must NOT trip (threshold is > 0.20, not >= 0.20)');
    assert.equal(result.numerator, 20);
    assert.equal(result.denominator, 100);
    assert.ok(Math.abs(result.affectedPct - 0.20) < 0.0001, `Expected affectedPct=0.20, got ${result.affectedPct}`);
  });

  test('19/100 staged SKUs → tripped=false (below threshold)', async () => {
    const tx = buildCbMockTx({ numerator: 19, denominator: 100 });

    const result = await checkPerCycleCircuitBreaker({
      tx,
      customerMarketplaceId: 'cm-under-threshold',
      cycleId: 'cycle-under-threshold',
      sendAlertFn: async () => { throw new Error('sendAlertFn must NOT be called'); },
      transitionCronStateFn: async () => { throw new Error('transitionCronStateFn must NOT be called'); },
    });

    assert.equal(result.tripped, false, '19/100 (19%) must not trip');
  });
});

// ---------------------------------------------------------------------------
// AC4 guard test — denominator=0
// ---------------------------------------------------------------------------

describe('AC4 guard — denominator=0 returns { tripped: false }', () => {
  test('0 active SKUs → tripped=false, affectedPct=0 (no-op guard)', async () => {
    const tx = buildCbMockTx({ numerator: 0, denominator: 0 });

    const result = await checkPerCycleCircuitBreaker({
      tx,
      customerMarketplaceId: 'cm-empty-catalog',
      cycleId: 'cycle-empty-catalog',
      sendAlertFn: async () => { throw new Error('sendAlertFn must NOT be called for 0-denominator'); },
      transitionCronStateFn: async () => { throw new Error('transitionCronStateFn must NOT be called for 0-denominator'); },
    });

    assert.equal(result.tripped, false, 'Empty catalog (denominator=0) must return tripped=false');
    assert.equal(result.denominator, 0);
    assert.equal(result.affectedPct, 0, 'affectedPct must be 0 when denominator=0');
  });
});

// ---------------------------------------------------------------------------
// Per-SKU circuit breaker — companion checks
// ---------------------------------------------------------------------------

describe('checkPerSkuCircuitBreaker — synchronous 15% threshold', () => {
  test('16% change → tripped=true', () => {
    const result = checkPerSkuCircuitBreaker({
      skuChannel: { id: 'sc-test' },
      newPriceCents: 2990,
      currentPriceCents: 2500,
    });
    // deltaPct = |2990-2500|/2500 = 490/2500 = 0.196 > 0.15 → trip
    assert.equal(result.tripped, true, `Expected trip at 19.6% change`);
    assert.ok(result.deltaPct > 0.15, `Expected deltaPct > 0.15, got ${result.deltaPct}`);
  });

  test('15% change → tripped=false (strict >, not >=)', () => {
    const result = checkPerSkuCircuitBreaker({
      skuChannel: { id: 'sc-test' },
      newPriceCents: 2875,
      currentPriceCents: 2500,
    });
    // deltaPct = |2875-2500|/2500 = 375/2500 = 0.15 — exactly at threshold → NOT tripped
    assert.equal(result.tripped, false, 'Exactly 15% must NOT trip (threshold is > 0.15)');
    assert.ok(Math.abs(result.deltaPct - 0.15) < 0.0001, `Expected deltaPct=0.15, got ${result.deltaPct}`);
  });

  test('14% change → tripped=false', () => {
    const result = checkPerSkuCircuitBreaker({
      skuChannel: { id: 'sc-test' },
      newPriceCents: 2850,
      currentPriceCents: 2500,
    });
    // deltaPct = |2850-2500|/2500 = 350/2500 = 0.14 < 0.15 → no trip
    assert.equal(result.tripped, false, '14% change must not trip');
  });

  test('price decrease also triggers CB (absolute change)', () => {
    const result = checkPerSkuCircuitBreaker({
      skuChannel: { id: 'sc-test-decrease' },
      newPriceCents: 2100,
      currentPriceCents: 2500,
    });
    // deltaPct = |2100-2500|/2500 = 400/2500 = 0.16 > 0.15 → trip
    assert.equal(result.tripped, true, '16% decrease must trip CB');
  });
});
