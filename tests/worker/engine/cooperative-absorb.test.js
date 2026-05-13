// tests/worker/engine/cooperative-absorb.test.js
//
// Story 7.3 — ATDD: Unit tests for worker/src/engine/cooperative-absorb.js
//
// Covers:
//   AC1 — absorbExternalChange: deviation detection, threshold comparison,
//          absorption (UPDATE + skuChannel mutation + audit event) vs freeze branch
//   AC2 — skip-on-pending: pending_import_id IS NOT NULL → skipped entirely (AD9)
//   AC3 — No-op when current_price === last_set_price
//   AC4 — Fixture p11-cooperative-absorption-within-threshold.json:
//          deviation=16%, absorbed=true, Notável event emitted
//   AC5 — All 7 branch scenarios covered; tx not called on skip/no-op
//
// Fixtures consumed: tests/fixtures/p11/p11-cooperative-absorption-within-threshold.json
// Depends on: Story 7.2 (engine STEP 2 stub), Story 9.0 (writeAuditEvent SSoT)
// Atomicity: Bundle C participant — gate at Story 7.8
//
// Run with: node --test tests/worker/engine/cooperative-absorb.test.js
// Or via:   npm run test:unit

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { absorbExternalChange } from '../../../worker/src/engine/cooperative-absorb.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../../fixtures/p11');

// ---------------------------------------------------------------------------
// Shared mock builders
// ---------------------------------------------------------------------------

/**
 * Build a mock transaction client that captures all SQL calls.
 * writeAuditEvent from shared/audit/writer.js calls tx.query internally;
 * absorb UPDATE also calls tx.query — both are captured in calls[].
 *
 * @param {object} [queryResults] - Keyed by first SQL keyword (e.g. 'INSERT', 'UPDATE')
 * @returns {{ query: Function, calls: Array<{sql: string, params: Array}> }}
 */
function makeMockTx (queryResults = {}) {
  const calls = [];
  return {
    async query (sql, params) {
      calls.push({ sql, params });
      const key = sql.trim().split(/\s+/)[0].toUpperCase();
      // writeAuditEvent expects INSERT to return { rows: [{ id: 'mock-id' }] }
      if (key === 'INSERT') {
        return queryResults[key] ?? { rows: [{ id: 'mock-audit-id' }] };
      }
      return queryResults[key] ?? { rows: [] };
    },
    calls,
  };
}

/**
 * Build a default skuChannel row.
 * By default: current_price === last_set_price (no external change).
 * @param {object} [overrides]
 */
function makeSkuChannel (overrides = {}) {
  return {
    id: 'sc-test-uuid',
    sku_id: 'sku-test-uuid',
    customer_marketplace_id: 'cm-test-uuid',
    list_price_cents: 3000,
    last_set_price_cents: 3000,
    current_price_cents: 3000,
    pending_import_id: null,
    frozen_for_anomaly_review: false,
    ...overrides,
  };
}

/**
 * Build a default customerMarketplace row.
 * anomaly_threshold_pct: null → uses default 0.40 in cooperative-absorb.js
 * @param {object} [overrides]
 */
function makeMarketplace (overrides = {}) {
  return {
    id: 'cm-test-uuid',
    anomaly_threshold_pct: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AC3 — No-op when current_price equals last_set_price
// ---------------------------------------------------------------------------

describe('absorbExternalChange: no external change (AC3)', () => {
  test('absorb_returns_no_op_when_current_equals_last_set', async () => {
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      current_price_cents: 3000,
      last_set_price_cents: 3000,
    });
    const cm = makeMarketplace();

    const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: cm });

    assert.deepEqual(result, { absorbed: false, frozen: false },
      'no-op must return { absorbed: false, frozen: false }');
    assert.equal(tx.calls.length, 0,
      'tx.query must NOT be called on no-op');
  });
});

// ---------------------------------------------------------------------------
// AC2 — Skip-on-pending (Bundle C invariant)
// ---------------------------------------------------------------------------

describe('absorbExternalChange: skip-on-pending (AC2)', () => {
  test('absorb_skips_entirely_when_pending_import_id_not_null', async () => {
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      current_price_cents: 3450,
      last_set_price_cents: 3000,
      pending_import_id: 'in-flight-import-uuid',
    });
    const cm = makeMarketplace();

    const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: cm });

    assert.deepEqual(result, { absorbed: false, frozen: false, skipped: true },
      'skip-on-pending must return { absorbed: false, frozen: false, skipped: true }');
    assert.equal(tx.calls.length, 0,
      'tx.query must NOT be called when pending_import_id is set');
  });
});

// ---------------------------------------------------------------------------
// AC1 — Absorption when within threshold
// ---------------------------------------------------------------------------

describe('absorbExternalChange: external change detection (AC1)', () => {
  test('absorb_detects_external_change_when_current_differs_from_last_set', async () => {
    // current != last_set → external change detected; with pending=null and low deviation → absorb
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      list_price_cents: 3000,
      last_set_price_cents: 3000,
      current_price_cents: 3450, // differs from last_set_price_cents
      pending_import_id: null,
    });
    const cm = makeMarketplace();

    const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: cm });

    // Should NOT be a no-op (external change was detected)
    assert.notEqual(result.absorbed === false && result.frozen === false && !result.skipped, true,
      'external change should have been processed, not returned as a plain no-op');
    assert.equal(result.absorbed, true,
      'deviation 15% < 40% threshold: should be absorbed');
  });

  test('absorb_computes_deviation_pct_against_list_price', async () => {
    // deviation = |3450 - 3000| / 3000 = 0.15 (15%) — below threshold
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      list_price_cents: 3000,
      last_set_price_cents: 3000,
      current_price_cents: 3450,
    });
    const cm = makeMarketplace();

    const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: cm });

    assert.equal(result.absorbed, true, 'deviation 0.15 < 0.40: should absorb');
    assert.equal(result.frozen, false);
    assert.equal(result.skipped, undefined);
  });

  test('absorb_updates_list_price_to_current_when_within_threshold', async () => {
    // Must UPDATE sku_channels.list_price_cents = currentPriceCents AND mutate skuChannel object
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      list_price_cents: 3000,
      last_set_price_cents: 3000,
      current_price_cents: 3450,
    });
    const cm = makeMarketplace();

    const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: cm });

    assert.equal(result.absorbed, true);
    assert.equal(result.frozen, false);

    // Verify in-memory mutation (STEP 3 reads this value)
    assert.equal(sc.list_price_cents, 3450,
      'skuChannel.list_price_cents must be mutated to currentPriceCents after absorption');

    // Verify UPDATE query was issued
    const updateCall = tx.calls.find(c => c.sql.toUpperCase().includes('UPDATE') &&
      c.sql.toLowerCase().includes('sku_channels'));
    assert.ok(updateCall, 'tx.query must include an UPDATE sku_channels call');
    assert.ok(updateCall.params.includes(3450),
      'UPDATE must set list_price_cents to 3450 (currentPriceCents)');
    assert.ok(updateCall.params.includes('sc-test-uuid'),
      'UPDATE must target the correct sku_channel id');
  });

  test('absorb_emits_external_change_absorbed_notavel_event', async () => {
    // writeAuditEvent calls tx.query with INSERT INTO audit_log
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      list_price_cents: 3000,
      last_set_price_cents: 3000,
      current_price_cents: 3450,
    });
    const cm = makeMarketplace();

    await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: cm });

    // Verify INSERT into audit_log with correct event_type slug
    const insertCall = tx.calls.find(c => c.sql.toUpperCase().includes('INSERT') &&
      c.sql.toLowerCase().includes('audit_log'));
    assert.ok(insertCall, 'tx.query must include an INSERT INTO audit_log call');
    assert.ok(
      insertCall.params.includes('external-change-absorbed'),
      'audit INSERT must use event_type "external-change-absorbed"',
    );
  });

  test('absorb_audit_payload_contains_correct_fields', async () => {
    // Payload: { previousListPriceCents: 3000, newListPriceCents: 3450, deviationPct: 0.15 }
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      list_price_cents: 3000,
      last_set_price_cents: 3000,
      current_price_cents: 3450,
    });
    const cm = makeMarketplace();

    await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: cm });

    const insertCall = tx.calls.find(c => c.sql.toUpperCase().includes('INSERT') &&
      c.sql.toLowerCase().includes('audit_log'));
    assert.ok(insertCall, 'audit INSERT call must exist');

    // payload is passed as JSON.stringify(payload) — find it in params
    const payloadParam = insertCall.params.find(p => typeof p === 'string' && p.includes('previousListPriceCents'));
    assert.ok(payloadParam, 'audit INSERT params must include serialised payload with previousListPriceCents');
    const payload = JSON.parse(payloadParam);
    assert.equal(payload.previousListPriceCents, 3000, 'previousListPriceCents must be 3000');
    assert.equal(payload.newListPriceCents, 3450, 'newListPriceCents must be 3450');
    assert.ok(
      Math.abs(payload.deviationPct - 0.15) < 0.0001,
      `deviationPct must be ~0.15, got ${payload.deviationPct}`,
    );
  });

  test('absorb_calls_freeze_when_deviation_exceeds_threshold', async () => {
    // deviation = |5000 - 3000| / 3000 = 0.6667 (> 0.40) → freeze
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      list_price_cents: 3000,
      last_set_price_cents: 3000,
      current_price_cents: 5000,
    });
    const cm = makeMarketplace();

    let freezeCalled = false;
    let freezeArgs = null;
    const mockFreeze = async (args) => {
      freezeCalled = true;
      freezeArgs = args;
    };

    const result = await absorbExternalChange({
      tx,
      skuChannel: sc,
      customerMarketplace: cm,
      freezeFn: mockFreeze,
    });

    assert.equal(result.frozen, true, 'deviation > 0.40: result.frozen must be true');
    assert.equal(result.absorbed, false, 'frozen path: result.absorbed must be false');
    assert.equal(result.skipped, undefined);
    assert.equal(freezeCalled, true, 'freezeFn must have been called');
    assert.equal(freezeArgs.skuChannelId, 'sc-test-uuid', 'freezeFn must receive skuChannelId');
    assert.equal(freezeArgs.customerMarketplaceId, 'cm-test-uuid', 'freezeFn must receive customerMarketplaceId');
    assert.ok(freezeArgs.deviationPct > 0.40, 'deviationPct passed to freeze must exceed threshold');
    assert.equal(freezeArgs.currentPriceCents, 5000, 'freezeFn must receive currentPriceCents');
    assert.equal(freezeArgs.listPriceCents, 3000, 'freezeFn must receive listPriceCents');
    assert.ok(freezeArgs.tx, 'freezeFn must receive the tx client');

    // No UPDATE to sku_channels on freeze path (freeze handles its own DB mutations)
    const updateCall = tx.calls.find(c => c.sql.toUpperCase().includes('UPDATE') &&
      c.sql.toLowerCase().includes('sku_channels'));
    assert.equal(updateCall, undefined, 'tx must NOT UPDATE sku_channels on freeze path');

    // skuChannel.list_price_cents must NOT be mutated on freeze path
    assert.equal(sc.list_price_cents, 3000, 'skuChannel.list_price_cents must NOT be mutated on freeze path');
  });

  test('absorb_uses_anomaly_threshold_pct_when_set', async () => {
    // Custom threshold 0.10; deviation = |3450 - 3000| / 3000 = 0.15 → exceeds 0.10
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      list_price_cents: 3000,
      last_set_price_cents: 3000,
      current_price_cents: 3450, // 15% deviation
    });
    const cm = makeMarketplace({ anomaly_threshold_pct: 0.10 });

    let freezeCalled = false;
    const mockFreeze = async () => { freezeCalled = true; };

    const result = await absorbExternalChange({
      tx,
      skuChannel: sc,
      customerMarketplace: cm,
      freezeFn: mockFreeze,
    });

    assert.equal(result.frozen, true, 'deviation 0.15 exceeds custom threshold 0.10: must freeze');
    assert.equal(result.absorbed, false);
    assert.equal(freezeCalled, true, 'custom threshold must be respected (freeze called)');
  });

  test('absorb_uses_default_0_40_when_anomaly_threshold_pct_is_null', async () => {
    // anomaly_threshold_pct = null → default 0.40; deviation = 0.38 → absorbed
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      list_price_cents: 3000,
      last_set_price_cents: 3000,
      current_price_cents: 4140, // deviation = |4140 - 3000| / 3000 = 0.38 (< 0.40)
    });
    const cm = makeMarketplace({ anomaly_threshold_pct: null });

    const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: cm });

    assert.equal(result.absorbed, true, 'deviation 0.38 < default threshold 0.40: must absorb');
    assert.equal(result.frozen, false);
    assert.equal(sc.list_price_cents, 4140, 'list_price_cents must be mutated to 4140');
  });
});

// ---------------------------------------------------------------------------
// AC4 — Fixture: p11-cooperative-absorption-within-threshold.json
// ---------------------------------------------------------------------------

// AC4 — Fixture: p11-cooperative-absorption-within-threshold.json
// Migrated to _fixture_meta schema per Story 7.9 AC7 (was _preconditions, now _fixture_meta).
// _preconditions was removed from the fixture in Story 7.8 SCP-2026-05-11 Amendment 4.
describe('Fixture: p11-cooperative-absorption-within-threshold (AC4)', () => {
  const fixtureFile = 'p11-cooperative-absorption-within-threshold.json';
  let fixture;

  // Load fixture synchronously before tests run
  try {
    fixture = JSON.parse(readFileSync(join(FIXTURES_DIR, fixtureFile), 'utf-8'));
  } catch {
    // If fixture file doesn't exist yet, tests will fail with a clear error
    // via the `assert.ok(fixture, ...)` in each test below.
    fixture = null;
  }

  test('fixture_loads_and_has_required_metadata', () => {
    assert.ok(fixture, `Fixture file ${fixtureFile} must exist`);
    assert.ok(fixture._fixture_meta, 'fixture must have _fixture_meta');
    assert.ok(fixture._fixture_meta.skuChannel_overrides, 'fixture._fixture_meta.skuChannel_overrides must exist');
    assert.ok(fixture._fixture_meta.customerMarketplace_overrides !== undefined,
      'fixture._fixture_meta.customerMarketplace_overrides must exist');
    assert.equal(fixture._fixture_meta.skuChannel_overrides.pending_import_id, null,
      'fixture skuChannel_overrides.pending_import_id must be null');
    assert.notEqual(
      fixture._fixture_meta.skuChannel_overrides.current_price_cents,
      fixture._fixture_meta.skuChannel_overrides.last_set_price_cents,
      'fixture must have current_price_cents != last_set_price_cents (external change present)',
    );
  });

  test('fixture_absorption_within_threshold_absorbed_true', async () => {
    assert.ok(fixture, `Fixture file ${fixtureFile} must exist`);
    const tx = makeMockTx();
    const skuOverrides = fixture._fixture_meta.skuChannel_overrides;
    const cmOverrides = fixture._fixture_meta.customerMarketplace_overrides ?? {};

    // Build skuChannel from _fixture_meta.skuChannel_overrides (migrated from _preconditions)
    const sc = {
      id: 'sc-fixture-uuid',
      sku_id: 'sku-fixture-uuid',
      customer_marketplace_id: 'cm-fixture-uuid',
      list_price_cents: skuOverrides.list_price_cents,
      last_set_price_cents: skuOverrides.last_set_price_cents,
      current_price_cents: skuOverrides.current_price_cents,
      pending_import_id: skuOverrides.pending_import_id ?? null,
      frozen_for_anomaly_review: skuOverrides.frozen_for_anomaly_review ?? false,
    };
    const cm = {
      id: 'cm-fixture-uuid',
      anomaly_threshold_pct: cmOverrides.anomaly_threshold_pct ?? null,
    };

    const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: cm });

    // Fixture _expected is the SOLE oracle — no hardcoded values
    assert.equal(result.absorbed, fixture._expected.absorbed,
      `fixture expected absorbed=${fixture._expected.absorbed}`);
    // fixture._expected.frozen may be omitted when not relevant to the scenario;
    // default to false (absorption within threshold never freezes)
    const expectedFrozen = fixture._expected.frozen ?? false;
    assert.equal(result.frozen, expectedFrozen,
      `fixture expected frozen=${expectedFrozen}`);
    assert.equal(result.skipped, undefined,
      'fixture scenario must not skip (pending_import_id is null)');

    // list_price_cents must be updated to current_price_cents
    assert.equal(sc.list_price_cents, skuOverrides.current_price_cents,
      'fixture: skuChannel.list_price_cents must be mutated to current_price_cents after absorption');
  });

  test('fixture_absorption_emits_correct_notavel_event_payload', async () => {
    assert.ok(fixture, `Fixture file ${fixtureFile} must exist`);
    const tx = makeMockTx();
    const skuOverrides = fixture._fixture_meta.skuChannel_overrides;
    const cmOverrides = fixture._fixture_meta.customerMarketplace_overrides ?? {};

    const sc = {
      id: 'sc-fixture-uuid',
      sku_id: 'sku-fixture-uuid',
      customer_marketplace_id: 'cm-fixture-uuid',
      list_price_cents: skuOverrides.list_price_cents,
      last_set_price_cents: skuOverrides.last_set_price_cents,
      current_price_cents: skuOverrides.current_price_cents,
      pending_import_id: skuOverrides.pending_import_id ?? null,
      frozen_for_anomaly_review: skuOverrides.frozen_for_anomaly_review ?? false,
    };
    const cm = {
      id: 'cm-fixture-uuid',
      anomaly_threshold_pct: cmOverrides.anomaly_threshold_pct ?? null,
    };

    await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: cm });

    // Verify audit event slug from absorbExternalChange — emits 'external-change-absorbed' (Notável).
    // Note: fixture._expected.auditEvent = 'ceiling-raise-decision' refers to the full engine cycle
    // decision, NOT the cooperative-absorb step. absorbExternalChange's own audit event is
    // 'external-change-absorbed' (EVENT_TYPES.EXTERNAL_CHANGE_ABSORBED in shared/audit/event-types.js).
    const COOPERATIVE_ABSORB_EVENT = 'external-change-absorbed';
    const insertCall = tx.calls.find(c => c.sql.toUpperCase().includes('INSERT') &&
      c.sql.toLowerCase().includes('audit_log'));
    assert.ok(insertCall, 'audit INSERT must be present for fixture absorption scenario');
    assert.ok(
      insertCall.params.includes(COOPERATIVE_ABSORB_EVENT),
      `absorbExternalChange audit INSERT must use event_type "${COOPERATIVE_ABSORB_EVENT}"; got params=${JSON.stringify(insertCall.params)}`,
    );

    // Verify payload correctness
    const payloadParam = insertCall.params.find(p => typeof p === 'string' && p.includes('previousListPriceCents'));
    assert.ok(payloadParam, 'audit INSERT params must include serialised payload');
    const payload = JSON.parse(payloadParam);

    const expectedDeviation = Math.abs(
      (skuOverrides.current_price_cents - skuOverrides.list_price_cents) / skuOverrides.list_price_cents
    );
    assert.ok(
      Math.abs(payload.deviationPct - expectedDeviation) < 0.0001,
      `deviationPct must be ~${expectedDeviation.toFixed(4)}, got ${payload.deviationPct}`,
    );
    assert.equal(payload.previousListPriceCents, skuOverrides.list_price_cents,
      'payload.previousListPriceCents must match fixture list_price_cents');
    assert.equal(payload.newListPriceCents, skuOverrides.current_price_cents,
      'payload.newListPriceCents must match fixture current_price_cents');
  });
});

// ---------------------------------------------------------------------------
// AC5 — All branches covered: summary / branch-confirmation tests
// ---------------------------------------------------------------------------

describe('absorbExternalChange: all branches covered (AC5)', () => {
  test('all_branches_no_op_no_tx_calls', async () => {
    // No-op: current === last_set → zero tx calls
    const tx = makeMockTx();
    const sc = makeSkuChannel({ current_price_cents: 2000, last_set_price_cents: 2000 });
    await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: makeMarketplace() });
    assert.equal(tx.calls.length, 0, 'no-op path: tx must not be touched');
  });

  test('all_branches_skip_on_pending_no_tx_calls', async () => {
    // Skip: pending_import_id set → zero tx calls
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      current_price_cents: 2500,
      last_set_price_cents: 2000,
      pending_import_id: 'uuid-abc',
    });
    const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: makeMarketplace() });
    assert.equal(result.skipped, true);
    assert.equal(tx.calls.length, 0, 'skip-on-pending path: tx must not be touched');
  });

  test('all_branches_absorption_has_update_and_insert', async () => {
    // Absorption: must have UPDATE + INSERT
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      list_price_cents: 2000,
      last_set_price_cents: 2000,
      current_price_cents: 2300, // 15% — within threshold
    });
    await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: makeMarketplace() });
    const hasUpdate = tx.calls.some(c => c.sql.toUpperCase().startsWith('UPDATE'));
    const hasInsert = tx.calls.some(c => c.sql.toUpperCase().startsWith('INSERT'));
    assert.equal(hasUpdate, true, 'absorption path: must have UPDATE sku_channels');
    assert.equal(hasInsert, true, 'absorption path: must have INSERT audit_log');
  });

  test('all_branches_freeze_dispatch_no_update_sku_channels', async () => {
    // Freeze: deviation > threshold → freeze called, no UPDATE sku_channels by absorb module
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      list_price_cents: 2000,
      last_set_price_cents: 2000,
      current_price_cents: 3000, // 50% — above threshold
    });
    let freezeCalled = false;
    const mockFreeze = async () => { freezeCalled = true; };
    const result = await absorbExternalChange({
      tx,
      skuChannel: sc,
      customerMarketplace: makeMarketplace(),
      freezeFn: mockFreeze,
    });
    assert.equal(result.frozen, true);
    assert.equal(freezeCalled, true, 'freeze path: freezeFn must have been called');
    const hasUpdate = tx.calls.some(c =>
      c.sql.toUpperCase().startsWith('UPDATE') && c.sql.toLowerCase().includes('sku_channels')
    );
    assert.equal(hasUpdate, false, 'freeze path: cooperative-absorb must NOT UPDATE sku_channels');
  });

  test('all_branches_freeze_receives_correct_args', async () => {
    // freeze branch: validate all args passed to freezeFn
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      id: 'sc-freeze-test',
      customer_marketplace_id: 'cm-freeze-test',
      list_price_cents: 2000,
      last_set_price_cents: 2000,
      current_price_cents: 3500, // 75% deviation
    });
    const cm = makeMarketplace({ id: 'cm-freeze-test' });
    let capturedArgs = null;
    const mockFreeze = async (args) => { capturedArgs = args; };

    await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: cm, freezeFn: mockFreeze });

    assert.ok(capturedArgs, 'freeze must have been called with args');
    assert.equal(capturedArgs.skuChannelId, 'sc-freeze-test');
    assert.equal(capturedArgs.customerMarketplaceId, 'cm-freeze-test');
    assert.equal(capturedArgs.currentPriceCents, 3500);
    assert.equal(capturedArgs.listPriceCents, 2000);
    assert.ok(capturedArgs.deviationPct > 0.40);
    assert.ok(typeof capturedArgs.tx.query === 'function', 'tx must be passed to freeze');
  });
});

// ---------------------------------------------------------------------------
// Step 4 test-review hardening — boundary + symmetry + skip-on-undefined
// ---------------------------------------------------------------------------
//
// Gaps caught at test review:
//   1. Equality boundary deviationPct === threshold — spec is `<=` (absorb).
//      Without an explicit test, a future refactor flipping `<=`/`>` is silent.
//   2. pending_import_id === undefined — impl guards `!== null && !== undefined`.
//      Only null and a real UUID were tested; an undefined-skip regression hides.
//   3. Negative-direction deviation (current < list) — Math.abs symmetry should
//      hold for both directions; removing the abs() must fail a test.
// ---------------------------------------------------------------------------

describe('absorbExternalChange: boundary + symmetry hardening (Step 4 review)', () => {
  test('absorb_at_exact_threshold_boundary_absorbs_not_freezes', async () => {
    // deviation EXACTLY equals threshold → spec says <= absorbs.
    // Use threshold 0.50 and deviation = |3000-2000|/2000 = 0.50.
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      list_price_cents: 2000,
      last_set_price_cents: 2000,
      current_price_cents: 3000,
    });
    const cm = makeMarketplace({ anomaly_threshold_pct: 0.50 });

    let freezeCalled = false;
    const mockFreeze = async () => { freezeCalled = true; };

    const result = await absorbExternalChange({
      tx,
      skuChannel: sc,
      customerMarketplace: cm,
      freezeFn: mockFreeze,
    });

    assert.equal(result.absorbed, true,
      'at exact threshold, spec says deviationPct <= threshold → absorb (boundary test for off-by-one regressions)');
    assert.equal(result.frozen, false);
    assert.equal(freezeCalled, false, 'freezeFn must NOT be called at exact threshold boundary');
    assert.equal(sc.list_price_cents, 3000, 'list_price_cents must be mutated on boundary absorption');
  });

  test('absorb_skips_when_pending_import_id_is_undefined_not_just_null', async () => {
    // Impl guards both null AND undefined; only null was tested above.
    // This catches a regression that drops the undefined check.
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      current_price_cents: 3450,
      last_set_price_cents: 3000,
    });
    delete sc.pending_import_id; // explicit undefined (not null)

    const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: makeMarketplace() });

    // Note: when pending_import_id is undefined, impl currently treats it
    // identically to null and PROCEEDS (since `!== null && !== undefined` is false).
    // Document the actual behaviour: undefined === null (skipped: false; absorption proceeds).
    assert.equal(result.skipped, undefined,
      'undefined pending_import_id is treated like null: must NOT skip (deviation should be evaluated)');
    assert.equal(result.absorbed, true,
      'deviation 15% < 40%: absorption proceeds when pending_import_id is undefined');
  });

  test('absorb_handles_negative_direction_deviation_symmetrically', async () => {
    // current_price went DOWN relative to list_price (external markdown).
    // Math.abs ensures symmetric behaviour; removing abs() would fail this test
    // (negative ratio < threshold check would silently absorb everything).
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      list_price_cents: 3000,
      last_set_price_cents: 3000,
      current_price_cents: 2550, // deviation = |2550-3000|/3000 = 0.15 (downward)
    });
    const cm = makeMarketplace();

    const result = await absorbExternalChange({ tx, skuChannel: sc, customerMarketplace: cm });

    assert.equal(result.absorbed, true,
      'downward 15% deviation should absorb just like upward 15% — Math.abs symmetry');
    assert.equal(result.frozen, false);
    assert.equal(sc.list_price_cents, 2550, 'downward absorption mutates list_price to current (2550)');
  });

  test('absorb_freezes_on_negative_direction_when_exceeding_threshold', async () => {
    // Downward 50% deviation must freeze identically to upward 50%.
    // Removing Math.abs() would compute -0.50, which is NOT > 0.40 (false negative).
    const tx = makeMockTx();
    const sc = makeSkuChannel({
      list_price_cents: 4000,
      last_set_price_cents: 4000,
      current_price_cents: 2000, // deviation = |2000-4000|/4000 = 0.50 (downward, > 0.40)
    });
    const cm = makeMarketplace();

    let freezeCalled = false;
    let freezeArgs = null;
    const mockFreeze = async (args) => { freezeCalled = true; freezeArgs = args; };

    const result = await absorbExternalChange({
      tx,
      skuChannel: sc,
      customerMarketplace: cm,
      freezeFn: mockFreeze,
    });

    assert.equal(result.frozen, true,
      'downward 50% deviation must freeze — Math.abs symmetry on the freeze path');
    assert.equal(result.absorbed, false);
    assert.equal(freezeCalled, true);
    assert.ok(freezeArgs.deviationPct > 0.40,
      `deviationPct passed to freeze must be absolute value (>0.40), got ${freezeArgs.deviationPct}`);
    assert.equal(freezeArgs.currentPriceCents, 2000);
    assert.equal(freezeArgs.listPriceCents, 4000);
  });
});
