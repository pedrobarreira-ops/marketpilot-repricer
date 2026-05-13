// tests/worker/engine/tier-classify.test.js
//
// Story 7.5 — ATDD: Unit tests for worker/src/engine/tier-classify.js
//
// Covers AC6 (10 test cases) — full 4-state tier transition table + F1 atomic
// dual-column write verification + optimistic-concurrency race-loser.
//
// Test list:
//   1.  T1 → T2a (won 1st place — hasCompetitors=true, currentPosition=1)
//   2.  T2a → T2b F1 atomic dual-column write (5h elapsed, > 4h window) — LOAD-BEARING
//   3.  T2a stays T2a (2h elapsed, within 4h window — steady-state)
//   4a. T2a → T1 on losing 1st place (currentPosition > 1)
//   4b. T2b → T1 on losing 1st place (currentPosition > 1)
//   5.  T3 → T2a (new competitor + winning 1st place)
//   6.  T3 → T1 (new competitor + losing)
//   7.  T3 stays T3 (no competitors — steady-state)
//   8.  Optimistic-concurrency race-loser (rowCount=0 → quiet return, no throw)
//   9.  T2b stays T2b (already winning at promoted cadence — steady-state)
//   10. {T1, T2a, T2b} → T3 (competitors disappeared — 3 sub-cases)
//
// Negative source-inspection assertions:
//   - tier-classify.js must NOT contain raw INSERT INTO audit_log (Pattern C — no audit emission)
//   - tier-classify.js must NOT contain console.log (pino only, Constraint #18)
//   - tier-classify.js must NOT import writeAuditEvent (Pattern C invariant)
//   - tier-classify.js must NOT have a default export (architecture convention)
//   - applyTierClassification must be a named export
//
// No RESEND_API_KEY env-stub required: tier-classify.js has no transitive resend
// dependency (Pattern C — no sendCriticalAlert; no writeAuditEvent; no HTTP calls).
// Plain static import is sufficient.
//
// F1 atomicity assertion (test 2) is LOAD-BEARING per Pedro's brief 2026-05-13:
//   The T2a→T2b transition MUST write tier AND tier_cadence_minutes in ONE UPDATE
//   statement. The test explicitly counts UPDATE sku_channels occurrences in _queries
//   and asserts exactly 1. A mock that issues 2 separate UPDATEs would fail this test,
//   which is the desired behaviour — it catches the F1 race scenario where
//   "dispatcher reads tier='2b' but tier_cadence_minutes still 15".
//
// Run with: node --test tests/worker/engine/tier-classify.test.js
// Or via:   npm run test:unit

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = join(__dirname, '../../../worker/src/engine/tier-classify.js');

// Static import — tier-classify.js has no transitive resend dependency.
// If this import fails with ERR_MODULE_NOT_FOUND, the dev agent has not yet
// created worker/src/engine/tier-classify.js. That is the expected ATDD state:
// tests are authored before implementation.
const { applyTierClassification } = await import('../../../worker/src/engine/tier-classify.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock tx that captures all SQL calls (query text + params).
 * Default response: { rowCount: 1, rows: [] } — transition succeeds.
 *
 * @param {object} [opts]
 * @param {number} [opts.updateRowCount=1] - Simulates rowCount on UPDATE (set to 0 for race-loser tests)
 * @returns {{ query: Function, _queries: Array<{sql: string, params: Array}> }}
 */
function buildMockTx ({ updateRowCount = 1 } = {}) {
  const _queries = [];
  return {
    async query (sql, params = []) {
      _queries.push({ sql, params });
      const sqlUpper = sql.trim().toUpperCase();

      // UPDATE sku_channels — rowCount is configurable
      if (sqlUpper.startsWith('UPDATE') && sql.toLowerCase().includes('sku_channels')) {
        return { rows: [], rowCount: updateRowCount };
      }

      return { rows: [], rowCount: 0 };
    },
    get _queries () { return _queries; },
  };
}

/**
 * Count how many captured queries are UPDATE sku_channels statements.
 * @param {Array<{sql: string, params: Array}>} queries
 * @returns {number}
 */
function countSkuChannelUpdates (queries) {
  return queries.filter(q =>
    q.sql.trim().toUpperCase().startsWith('UPDATE') &&
    q.sql.toLowerCase().includes('sku_channels'),
  ).length;
}

// ---------------------------------------------------------------------------
// Test 1 — T1 → T2a transition (won 1st place)
// ---------------------------------------------------------------------------

describe('applyTierClassification — T1 → T2a (won 1st place, AC6 test 1)', () => {
  test('t1_to_t2a_transition_issues_update_with_tier_cadence_last_won_at', async () => {
    // GIVEN: a T1 skuChannel, currentPosition=1, hasCompetitors=true
    const mockTx = buildMockTx();
    const skuChannel = {
      id: 'sc-1',
      tier: '1',
      tier_cadence_minutes: 15,
      last_won_at: null,
    };

    // WHEN: applyTierClassification is called
    const result = await applyTierClassification({
      tx: mockTx,
      skuChannel,
      currentPosition: 1,
      hasCompetitors: true,
    });

    // THEN: exactly 1 UPDATE sku_channels issued
    assert.equal(
      countSkuChannelUpdates(mockTx._queries), 1,
      'T1→T2a must issue exactly 1 UPDATE sku_channels',
    );

    const updateCall = mockTx._queries[0];

    // THEN: SET clause includes tier AND tier_cadence_minutes AND last_won_at
    const sqlLower = updateCall.sql.toLowerCase();
    assert.ok(
      sqlLower.includes('tier') && sqlLower.includes('tier_cadence_minutes'),
      `UPDATE SET clause must include tier and tier_cadence_minutes; got: ${updateCall.sql}`,
    );
    assert.ok(
      sqlLower.includes('last_won_at'),
      `T1→T2a UPDATE must include last_won_at (NOW()); got: ${updateCall.sql}`,
    );

    // THEN: params include '2a', 15 (T2a cadence), and '1' (expectedFromTier guard)
    assert.ok(
      updateCall.params.includes('2a'),
      `params must include '2a' (new tier); got: ${JSON.stringify(updateCall.params)}`,
    );
    assert.ok(
      updateCall.params.includes(15),
      `params must include 15 (T2a cadence); got: ${JSON.stringify(updateCall.params)}`,
    );
    assert.ok(
      updateCall.params.includes('1'),
      `params must include '1' (expectedFromTier guard in WHERE); got: ${JSON.stringify(updateCall.params)}`,
    );

    // THEN: return value matches T1→T2a transition
    assert.equal(result.tierTransitioned, true, 'tierTransitioned must be true');
    assert.equal(result.fromTier, '1', 'fromTier must be "1"');
    assert.equal(result.toTier, '2a', 'toTier must be "2a"');
    assert.ok(
      typeof result.reason === 'string' && result.reason.length > 0,
      `reason must be a non-empty string; got: ${result.reason}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2 — T2a → T2b F1 atomic dual-column write (LOAD-BEARING)
// ---------------------------------------------------------------------------

describe('applyTierClassification — T2a → T2b F1 atomic write (AC6 test 2, LOAD-BEARING)', () => {
  test('t2a_to_t2b_f1_atomic_dual_column_write_both_tier_and_cadence_in_one_update', async () => {
    // GIVEN: a T2a skuChannel with last_won_at 5 hours ago (> 4h window)
    const mockTx = buildMockTx();
    const skuChannel = {
      id: 'sc-2',
      tier: '2a',
      tier_cadence_minutes: 15,
      last_won_at: new Date(Date.now() - 5 * 60 * 60 * 1000),  // 5 hours ago
    };

    // WHEN: applyTierClassification is called (still winning, 5h elapsed → promote to T2b)
    const result = await applyTierClassification({
      tx: mockTx,
      skuChannel,
      currentPosition: 1,
      hasCompetitors: true,
    });

    // THEN: F1 atomicity — exactly 1 UPDATE sku_channels issued (NOT 2 separate updates)
    // This is the F1 race-prevention assertion: if tier and tier_cadence_minutes
    // appear in TWO separate UPDATE statements, the dispatcher could read tier='2b'
    // but see tier_cadence_minutes=15 in the window between the two writes.
    const skuUpdateCount = countSkuChannelUpdates(mockTx._queries);
    assert.equal(
      skuUpdateCount, 1,
      `F1 atomicity violated: expected exactly 1 UPDATE sku_channels (dual-column), ` +
      `got ${skuUpdateCount}. Two separate updates would re-introduce the dispatcher race.`,
    );

    const updateCall = mockTx._queries[0];
    const sqlLower = updateCall.sql.toLowerCase();

    // THEN: BOTH tier AND tier_cadence_minutes appear in the SET clause of ONE statement
    assert.ok(
      sqlLower.includes('tier') && sqlLower.includes('tier_cadence_minutes'),
      `F1: single UPDATE must set BOTH tier and tier_cadence_minutes; got: ${updateCall.sql}`,
    );

    // THEN: params include '2b' AND 45 (both T2b dual-write values)
    assert.ok(
      updateCall.params.includes('2b'),
      `params must include '2b' (new tier for T2b); got: ${JSON.stringify(updateCall.params)}`,
    );
    assert.ok(
      updateCall.params.includes(45),
      `params must include 45 (T2b cadence_minutes); got: ${JSON.stringify(updateCall.params)}`,
    );

    // THEN: params include '2a' (expectedFromTier guard)
    assert.ok(
      updateCall.params.includes('2a'),
      `params must include '2a' (WHERE tier guard); got: ${JSON.stringify(updateCall.params)}`,
    );

    // THEN: last_won_at NOT in the SET clause (T2a→T2b does not update last_won_at)
    // This is not strictly required by the spec for T2a→T2b, but tier_cadence_minutes=45
    // is enough — last_won_at is preserved from the T2a entry. Soft check.
    // (Spec AC1 table row: T2a→T2b: "UPDATE tier='2b', tier_cadence_minutes=45 WHERE tier='2a'")

    // THEN: return value matches T2a→T2b transition
    assert.equal(result.tierTransitioned, true, 'tierTransitioned must be true for T2a→T2b');
    assert.equal(result.fromTier, '2a', 'fromTier must be "2a"');
    assert.equal(result.toTier, '2b', 'toTier must be "2b"');
    assert.ok(
      typeof result.reason === 'string' && result.reason.length > 0,
      `reason must be a non-empty string; got: ${result.reason}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 3 — T2a stays T2a (within 4h window — steady-state)
// ---------------------------------------------------------------------------

describe('applyTierClassification — T2a stays T2a (steady-state, AC6 test 3)', () => {
  test('t2a_stays_t2a_no_update_when_last_won_at_within_4h_window', async () => {
    // GIVEN: T2a skuChannel with last_won_at 2 hours ago (within 4h window)
    const mockTx = buildMockTx();
    const skuChannel = {
      id: 'sc-3',
      tier: '2a',
      tier_cadence_minutes: 15,
      last_won_at: new Date(Date.now() - 2 * 60 * 60 * 1000),  // 2 hours ago
    };

    // WHEN: applyTierClassification is called (still winning, 2h elapsed — stable)
    const result = await applyTierClassification({
      tx: mockTx,
      skuChannel,
      currentPosition: 1,
      hasCompetitors: true,
    });

    // THEN: NO UPDATE issued (steady-state)
    assert.equal(
      mockTx._queries.length, 0,
      `T2a-stays-T2a must issue NO queries; got ${mockTx._queries.length}: ${JSON.stringify(mockTx._queries)}`,
    );

    // THEN: return value reflects no transition
    assert.equal(result.tierTransitioned, false, 'tierTransitioned must be false for steady-state T2a');
    assert.equal(result.fromTier, '2a', 'fromTier must be "2a"');
    assert.equal(result.toTier, '2a', 'toTier must be "2a" (same — no change)');
    assert.ok(
      typeof result.reason === 'string' && result.reason.length > 0,
      `reason must be a non-empty string; got: ${result.reason}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Test 4a — T2a → T1 on losing 1st place (currentPosition > 1)
// ---------------------------------------------------------------------------

describe('applyTierClassification — T2a → T1 (lost 1st place, AC6 test 4a)', () => {
  test('t2a_to_t1_when_losing_issues_update_tier_and_cadence_preserves_last_won_at', async () => {
    // GIVEN: T2a skuChannel, currentPosition=2 (lost 1st place), hasCompetitors=true
    const mockTx = buildMockTx();
    const lastWonAt = new Date(Date.now() - 10 * 60 * 60 * 1000);  // 10 hours ago
    const skuChannel = {
      id: 'sc-4a',
      tier: '2a',
      tier_cadence_minutes: 15,
      last_won_at: lastWonAt,
    };

    // WHEN
    const result = await applyTierClassification({
      tx: mockTx,
      skuChannel,
      currentPosition: 2,
      hasCompetitors: true,
    });

    // THEN: exactly 1 UPDATE issued
    assert.equal(countSkuChannelUpdates(mockTx._queries), 1, 'T2a→T1 must issue exactly 1 UPDATE');

    const updateCall = mockTx._queries[0];
    const sqlLower = updateCall.sql.toLowerCase();

    // THEN: SET clause includes tier='1' and tier_cadence_minutes=15
    assert.ok(
      updateCall.params.includes('1'),
      `params must include '1' (new tier T1); got: ${JSON.stringify(updateCall.params)}`,
    );
    assert.ok(
      updateCall.params.includes(15),
      `params must include 15 (T1 cadence); got: ${JSON.stringify(updateCall.params)}`,
    );

    // THEN: last_won_at NOT in SET clause (preserved — analytics signal per AC1 table)
    // The spec says "last_won_at preserved" for {T2a,T2b}→T1 transitions.
    // Verify by checking the SQL does NOT set last_won_at in the SET clause.
    // We look for patterns like "last_won_at = $N" in the SET portion (before WHERE).
    const setClause = sqlLower.split('where')[0];
    assert.ok(
      !setClause.includes('last_won_at'),
      `T2a→T1 UPDATE must NOT include last_won_at in SET clause (analytics preserved); ` +
      `got SET portion: ${setClause}`,
    );

    // THEN: WHERE clause includes the optimistic-concurrency guard (tier='2a')
    assert.ok(
      updateCall.params.includes('2a'),
      `WHERE guard must include '2a' (expectedFromTier); got: ${JSON.stringify(updateCall.params)}`,
    );

    // THEN: return value
    assert.equal(result.tierTransitioned, true, 'tierTransitioned must be true for T2a→T1');
    assert.equal(result.fromTier, '2a', 'fromTier must be "2a"');
    assert.equal(result.toTier, '1', 'toTier must be "1"');
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, 'reason must be a non-empty string');
  });
});

// ---------------------------------------------------------------------------
// Test 4b — T2b → T1 on losing 1st place (currentPosition > 1)
// ---------------------------------------------------------------------------

describe('applyTierClassification — T2b → T1 (lost 1st place, AC6 test 4b)', () => {
  test('t2b_to_t1_when_losing_issues_update_tier_and_cadence_preserves_last_won_at', async () => {
    // GIVEN: T2b skuChannel, currentPosition=2 (lost 1st place), hasCompetitors=true
    const mockTx = buildMockTx();
    const lastWonAt = new Date(Date.now() - 6 * 60 * 60 * 1000);  // 6 hours ago
    const skuChannel = {
      id: 'sc-4b',
      tier: '2b',
      tier_cadence_minutes: 45,
      last_won_at: lastWonAt,
    };

    // WHEN
    const result = await applyTierClassification({
      tx: mockTx,
      skuChannel,
      currentPosition: 2,
      hasCompetitors: true,
    });

    // THEN: exactly 1 UPDATE issued
    assert.equal(countSkuChannelUpdates(mockTx._queries), 1, 'T2b→T1 must issue exactly 1 UPDATE');

    const updateCall = mockTx._queries[0];

    // THEN: new tier is '1', cadence is 15
    assert.ok(
      updateCall.params.includes('1'),
      `params must include '1' (new tier T1); got: ${JSON.stringify(updateCall.params)}`,
    );
    assert.ok(
      updateCall.params.includes(15),
      `params must include 15 (T1 cadence); got: ${JSON.stringify(updateCall.params)}`,
    );

    // THEN: last_won_at NOT in SET clause (preserved)
    const setClause = updateCall.sql.toLowerCase().split('where')[0];
    assert.ok(
      !setClause.includes('last_won_at'),
      `T2b→T1 UPDATE must NOT include last_won_at in SET clause; got: ${setClause}`,
    );

    // THEN: WHERE guard includes '2b' (expectedFromTier)
    assert.ok(
      updateCall.params.includes('2b'),
      `WHERE guard must include '2b' (expectedFromTier); got: ${JSON.stringify(updateCall.params)}`,
    );

    // THEN: return value
    assert.equal(result.tierTransitioned, true, 'tierTransitioned must be true for T2b→T1');
    assert.equal(result.fromTier, '2b', 'fromTier must be "2b"');
    assert.equal(result.toTier, '1', 'toTier must be "1"');
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, 'reason must be a non-empty string');
  });
});

// ---------------------------------------------------------------------------
// Test 5 — T3 → T2a (new competitor + winning 1st place)
// ---------------------------------------------------------------------------

describe('applyTierClassification — T3 → T2a (new competitor + winning, AC6 test 5)', () => {
  test('t3_to_t2a_when_new_competitor_and_winning_issues_update_with_last_won_at', async () => {
    // GIVEN: T3 skuChannel, currentPosition=1, hasCompetitors=true
    const mockTx = buildMockTx();
    const skuChannel = {
      id: 'sc-5',
      tier: '3',
      tier_cadence_minutes: 1440,
      last_won_at: null,
    };

    // WHEN
    const result = await applyTierClassification({
      tx: mockTx,
      skuChannel,
      currentPosition: 1,
      hasCompetitors: true,
    });

    // THEN: exactly 1 UPDATE
    assert.equal(countSkuChannelUpdates(mockTx._queries), 1, 'T3→T2a must issue exactly 1 UPDATE');

    const updateCall = mockTx._queries[0];
    const sqlLower = updateCall.sql.toLowerCase();

    // THEN: SET tier='2a', tier_cadence_minutes=15, last_won_at=NOW()
    assert.ok(
      updateCall.params.includes('2a'),
      `params must include '2a' (new tier T2a); got: ${JSON.stringify(updateCall.params)}`,
    );
    assert.ok(
      updateCall.params.includes(15),
      `params must include 15 (T2a cadence); got: ${JSON.stringify(updateCall.params)}`,
    );
    assert.ok(
      sqlLower.includes('last_won_at'),
      `T3→T2a UPDATE must set last_won_at (NOW()); got: ${updateCall.sql}`,
    );

    // THEN: WHERE guard includes '3' (expectedFromTier)
    assert.ok(
      updateCall.params.includes('3'),
      `WHERE guard must include '3' (expectedFromTier); got: ${JSON.stringify(updateCall.params)}`,
    );

    // THEN: return value
    assert.equal(result.tierTransitioned, true, 'tierTransitioned must be true for T3→T2a');
    assert.equal(result.fromTier, '3', 'fromTier must be "3"');
    assert.equal(result.toTier, '2a', 'toTier must be "2a"');
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, 'reason must be a non-empty string');
  });
});

// ---------------------------------------------------------------------------
// Test 6 — T3 → T1 (new competitor + losing)
// ---------------------------------------------------------------------------

describe('applyTierClassification — T3 → T1 (new competitor + losing, AC6 test 6)', () => {
  test('t3_to_t1_when_new_competitor_and_losing_issues_update_without_last_won_at', async () => {
    // GIVEN: T3 skuChannel, currentPosition=2 (losing), hasCompetitors=true
    const mockTx = buildMockTx();
    const skuChannel = {
      id: 'sc-6',
      tier: '3',
      tier_cadence_minutes: 1440,
      last_won_at: null,
    };

    // WHEN
    const result = await applyTierClassification({
      tx: mockTx,
      skuChannel,
      currentPosition: 2,
      hasCompetitors: true,
    });

    // THEN: exactly 1 UPDATE
    assert.equal(countSkuChannelUpdates(mockTx._queries), 1, 'T3→T1 must issue exactly 1 UPDATE');

    const updateCall = mockTx._queries[0];
    const sqlLower = updateCall.sql.toLowerCase();

    // THEN: SET tier='1', tier_cadence_minutes=15
    assert.ok(
      updateCall.params.includes('1'),
      `params must include '1' (new tier T1); got: ${JSON.stringify(updateCall.params)}`,
    );
    assert.ok(
      updateCall.params.includes(15),
      `params must include 15 (T1 cadence); got: ${JSON.stringify(updateCall.params)}`,
    );

    // THEN: last_won_at NOT in SET clause (stays null — "last_won_at stays null" per AC1 table)
    const setClause = sqlLower.split('where')[0];
    assert.ok(
      !setClause.includes('last_won_at'),
      `T3→T1 UPDATE must NOT set last_won_at (stays null); got SET portion: ${setClause}`,
    );

    // THEN: WHERE guard includes '3' (expectedFromTier)
    assert.ok(
      updateCall.params.includes('3'),
      `WHERE guard must include '3' (expectedFromTier); got: ${JSON.stringify(updateCall.params)}`,
    );

    // THEN: return value
    assert.equal(result.tierTransitioned, true, 'tierTransitioned must be true for T3→T1');
    assert.equal(result.fromTier, '3', 'fromTier must be "3"');
    assert.equal(result.toTier, '1', 'toTier must be "1"');
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, 'reason must be a non-empty string');
  });
});

// ---------------------------------------------------------------------------
// Test 7 — T3 stays T3 (no competitors — steady-state)
// ---------------------------------------------------------------------------

describe('applyTierClassification — T3 stays T3 (no competitors, AC6 test 7)', () => {
  test('t3_stays_t3_no_update_when_no_competitors', async () => {
    // GIVEN: T3 skuChannel, hasCompetitors=false, currentPosition=null
    const mockTx = buildMockTx();
    const skuChannel = {
      id: 'sc-7',
      tier: '3',
      tier_cadence_minutes: 1440,
      last_won_at: null,
    };

    // WHEN: no competitors → steady-state T3
    const result = await applyTierClassification({
      tx: mockTx,
      skuChannel,
      currentPosition: null,
      hasCompetitors: false,
    });

    // THEN: NO UPDATE issued (T3-stays-T3 steady-state)
    assert.equal(
      mockTx._queries.length, 0,
      `T3-stays-T3 must issue NO queries; got ${mockTx._queries.length}: ${JSON.stringify(mockTx._queries)}`,
    );

    // THEN: return value
    assert.equal(result.tierTransitioned, false, 'tierTransitioned must be false for T3-stays-T3');
    assert.equal(result.fromTier, '3', 'fromTier must be "3"');
    assert.equal(result.toTier, '3', 'toTier must be "3" (no change)');
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, 'reason must be a non-empty string');
  });
});

// ---------------------------------------------------------------------------
// Test 8 — Optimistic-concurrency race-loser (rowCount=0)
// ---------------------------------------------------------------------------

describe('applyTierClassification — optimistic-concurrency race-loser (AC6 test 8)', () => {
  test('race_loser_rowcount_0_returns_quiet_no_throw_concurrent_transition_detected', async () => {
    // GIVEN: T1 skuChannel set up for T1→T2a (currentPosition=1, hasCompetitors=true)
    // BUT mockTx returns rowCount=0 (simulating concurrent transition by another process)
    const mockTx = buildMockTx({ updateRowCount: 0 });
    const skuChannel = {
      id: 'sc-8',
      tier: '1',
      tier_cadence_minutes: 15,
      last_won_at: null,
    };

    // WHEN: applyTierClassification is called — race condition, another process won
    let result;
    await assert.doesNotReject(
      async () => {
        result = await applyTierClassification({
          tx: mockTx,
          skuChannel,
          currentPosition: 1,
          hasCompetitors: true,
        });
      },
      'race-loser must NOT throw (quiet race-loss per spec AC1)',
    );

    // THEN: the UPDATE was attempted (1 captured query)
    assert.equal(
      countSkuChannelUpdates(mockTx._queries), 1,
      'race-loser must still attempt the UPDATE before discovering rowCount=0',
    );

    // THEN: return value reflects quiet race-loss
    assert.equal(result.tierTransitioned, false, 'tierTransitioned must be false for race-loser');
    assert.equal(result.reason, 'concurrent-transition-detected', 'reason must be "concurrent-transition-detected"');
    // fromTier and toTier should both reflect no-change (quiet race-loser)
    assert.ok(typeof result.fromTier === 'string', 'fromTier must be a string');
    assert.ok(typeof result.toTier === 'string', 'toTier must be a string');
  });
});

// ---------------------------------------------------------------------------
// Test 9 — T2b stays T2b (already winning at promoted cadence — steady-state)
// ---------------------------------------------------------------------------

describe('applyTierClassification — T2b stays T2b (already winning at promoted cadence, AC6 test 9)', () => {
  test('t2b_stays_t2b_no_update_when_winning_at_promoted_cadence', async () => {
    // GIVEN: T2b skuChannel, currentPosition=1, hasCompetitors=true
    const mockTx = buildMockTx();
    const skuChannel = {
      id: 'sc-9',
      tier: '2b',
      tier_cadence_minutes: 45,
      last_won_at: new Date(Date.now() - 3 * 60 * 60 * 1000),  // 3 hours ago
    };

    // WHEN: still winning at T2b cadence
    const result = await applyTierClassification({
      tx: mockTx,
      skuChannel,
      currentPosition: 1,
      hasCompetitors: true,
    });

    // THEN: NO UPDATE issued (T2b steady-state — already at promoted cadence, still winning)
    assert.equal(
      mockTx._queries.length, 0,
      `T2b-stays-T2b must issue NO queries; got ${mockTx._queries.length}: ${JSON.stringify(mockTx._queries)}`,
    );

    // THEN: return value
    assert.equal(result.tierTransitioned, false, 'tierTransitioned must be false for T2b-stays-T2b');
    assert.equal(result.fromTier, '2b', 'fromTier must be "2b"');
    assert.equal(result.toTier, '2b', 'toTier must be "2b" (no change)');
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, 'reason must be a non-empty string');
  });
});

// ---------------------------------------------------------------------------
// Test 10 — {T1, T2a, T2b} → T3 (competitors disappeared)
// ---------------------------------------------------------------------------

describe('applyTierClassification — {T1, T2a, T2b} → T3 (competitors disappeared, AC6 test 10)', () => {
  test('t1_to_t3_when_competitors_disappeared_issues_update_cadence_1440', async () => {
    // GIVEN: T1 skuChannel, hasCompetitors=false
    const mockTx = buildMockTx();
    const skuChannel = {
      id: 'sc-10a',
      tier: '1',
      tier_cadence_minutes: 15,
      last_won_at: null,
    };

    // WHEN
    const result = await applyTierClassification({
      tx: mockTx,
      skuChannel,
      currentPosition: null,
      hasCompetitors: false,
    });

    // THEN: exactly 1 UPDATE
    assert.equal(countSkuChannelUpdates(mockTx._queries), 1, 'T1→T3 must issue exactly 1 UPDATE');

    const updateCall = mockTx._queries[0];
    const setClause = updateCall.sql.toLowerCase().split('where')[0];

    // THEN: SET tier='3', tier_cadence_minutes=1440
    assert.ok(
      updateCall.params.includes('3'),
      `params must include '3' (new tier T3); got: ${JSON.stringify(updateCall.params)}`,
    );
    assert.ok(
      updateCall.params.includes(1440),
      `params must include 1440 (T3 daily cadence); got: ${JSON.stringify(updateCall.params)}`,
    );

    // THEN: last_won_at NOT in SET clause (preserved — analytics signal)
    assert.ok(
      !setClause.includes('last_won_at'),
      `T1→T3 UPDATE must NOT include last_won_at in SET clause (preserved); got: ${setClause}`,
    );

    // THEN: WHERE guard includes '1' (expectedFromTier)
    assert.ok(
      updateCall.params.includes('1'),
      `WHERE guard must include '1' (expectedFromTier); got: ${JSON.stringify(updateCall.params)}`,
    );

    // THEN: return value
    assert.equal(result.tierTransitioned, true, 'tierTransitioned must be true for T1→T3');
    assert.equal(result.fromTier, '1', 'fromTier must be "1"');
    assert.equal(result.toTier, '3', 'toTier must be "3"');
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, 'reason must be a non-empty string');
  });

  test('t2a_to_t3_when_competitors_disappeared_issues_update_preserves_last_won_at', async () => {
    // GIVEN: T2a skuChannel, hasCompetitors=false
    const mockTx = buildMockTx();
    const skuChannel = {
      id: 'sc-10b',
      tier: '2a',
      tier_cadence_minutes: 15,
      last_won_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
    };

    // WHEN
    const result = await applyTierClassification({
      tx: mockTx,
      skuChannel,
      currentPosition: null,
      hasCompetitors: false,
    });

    // THEN: exactly 1 UPDATE
    assert.equal(countSkuChannelUpdates(mockTx._queries), 1, 'T2a→T3 must issue exactly 1 UPDATE');

    const updateCall = mockTx._queries[0];
    const setClause = updateCall.sql.toLowerCase().split('where')[0];

    // THEN: SET tier='3', tier_cadence_minutes=1440
    assert.ok(updateCall.params.includes('3'), 'params must include "3"');
    assert.ok(updateCall.params.includes(1440), 'params must include 1440');

    // THEN: last_won_at NOT in SET clause (preserved)
    assert.ok(!setClause.includes('last_won_at'), 'T2a→T3 must NOT include last_won_at in SET');

    // THEN: WHERE guard includes '2a'
    assert.ok(updateCall.params.includes('2a'), 'WHERE guard must include "2a"');

    assert.equal(result.tierTransitioned, true);
    assert.equal(result.fromTier, '2a');
    assert.equal(result.toTier, '3');
  });

  test('t2b_to_t3_when_competitors_disappeared_issues_update_preserves_last_won_at', async () => {
    // GIVEN: T2b skuChannel, hasCompetitors=false
    const mockTx = buildMockTx();
    const skuChannel = {
      id: 'sc-10c',
      tier: '2b',
      tier_cadence_minutes: 45,
      last_won_at: new Date(Date.now() - 5 * 60 * 60 * 1000),
    };

    // WHEN
    const result = await applyTierClassification({
      tx: mockTx,
      skuChannel,
      currentPosition: null,
      hasCompetitors: false,
    });

    // THEN: exactly 1 UPDATE
    assert.equal(countSkuChannelUpdates(mockTx._queries), 1, 'T2b→T3 must issue exactly 1 UPDATE');

    const updateCall = mockTx._queries[0];
    const setClause = updateCall.sql.toLowerCase().split('where')[0];

    // THEN: SET tier='3', tier_cadence_minutes=1440
    assert.ok(updateCall.params.includes('3'), 'params must include "3"');
    assert.ok(updateCall.params.includes(1440), 'params must include 1440');

    // THEN: last_won_at NOT in SET clause (preserved)
    assert.ok(!setClause.includes('last_won_at'), 'T2b→T3 must NOT include last_won_at in SET');

    // THEN: WHERE guard includes '2b'
    assert.ok(updateCall.params.includes('2b'), 'WHERE guard must include "2b"');

    assert.equal(result.tierTransitioned, true);
    assert.equal(result.fromTier, '2b');
    assert.equal(result.toTier, '3');
  });
});

// ---------------------------------------------------------------------------
// Negative source-inspection assertions (Pattern C + architecture constraints)
// ---------------------------------------------------------------------------

describe('tier-classify.js — source-inspection negative assertions (AC6)', () => {
  test('source_does_not_contain_raw_insert_into_audit_log', () => {
    // Pattern C: tier-classify.js does NOT emit audit events. Constraint #21.
    const src = readFileSync(MODULE_PATH, 'utf-8');
    const lowerSrc = src.toLowerCase();
    assert.ok(
      !lowerSrc.includes('insert into audit_log'),
      'tier-classify.js must NOT contain raw INSERT INTO audit_log (Pattern C — no audit emission)',
    );
  });

  test('source_does_not_import_write_audit_event', () => {
    // Pattern C invariant: audit emission stays caller-side in cycle-assembly.
    const src = readFileSync(MODULE_PATH, 'utf-8');
    assert.ok(
      !src.includes('writeAuditEvent'),
      'tier-classify.js must NOT import or call writeAuditEvent (Pattern C)',
    );
  });

  test('source_does_not_contain_console_log', () => {
    // Constraint #18: pino only, never console.log.
    const src = readFileSync(MODULE_PATH, 'utf-8');
    assert.ok(
      !src.includes('console.log'),
      'tier-classify.js must NOT use console.log (Constraint #18 — use pino)',
    );
  });

  test('source_does_not_have_default_export', () => {
    // Architecture convention: named exports only, no default export.
    const src = readFileSync(MODULE_PATH, 'utf-8');
    assert.ok(
      !src.includes('export default'),
      'tier-classify.js must NOT have a default export (architecture convention)',
    );
  });

  test('applyTierClassification_is_a_named_export_function', () => {
    // Verify the module exports applyTierClassification as a named function.
    assert.ok(
      typeof applyTierClassification === 'function',
      `applyTierClassification must be exported as a function; got typeof=${typeof applyTierClassification}`,
    );
  });
});
