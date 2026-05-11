// tests/worker/engine/decide.test.js
//
// Story 7.2 — ATDD: Unit tests for worker/src/engine/decide.js
//
// Covers AC4: all 12 P11 fixtures pass against decideForSkuChannel.
// Also covers AC1 (6-step flow), AC2 (filter chain), AC3 (tie handling).
//
// NOTE: These tests import decide.js directly. Before running, the dev agent
// must have cherry-picked shared/money/index.js from main (Story 7.1) and
// implemented worker/src/engine/decide.js per the story spec.
//
// Run with: node --test tests/worker/engine/decide.test.js
// Or via:   npm run test:unit

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../../fixtures/p11');

/**
 * Load a P11 fixture JSON file by name.
 * @param {string} name - filename without directory
 * @returns {object}
 */
function loadFixture (name) {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8'));
}

// ---------------------------------------------------------------------------
// Shared mock builders (matches story spec Test structure section)
// ---------------------------------------------------------------------------

/**
 * Build a default skuChannel row with sensible test defaults.
 * list_price_cents=3000, current_price_cents=3199 (position 2 vs 28.50 competitor).
 * All preconditions pass by default.
 * @param {object} [overrides]
 */
function makeSkuChannel (overrides = {}) {
  return {
    id: 'sc-test-uuid',
    sku_id: 'sku-test-uuid',
    customer_marketplace_id: 'cm-test-uuid',
    channel_code: 'WRT_PT_ONLINE',
    list_price_cents: 3000,
    last_set_price_cents: 3199,
    current_price_cents: 3199,
    pending_set_price_cents: null,
    pending_import_id: null,
    tier: '1',
    tier_cadence_minutes: 15,
    last_won_at: null,
    last_checked_at: new Date().toISOString(),
    frozen_for_anomaly_review: false,
    frozen_for_pri01_persistent: false,
    frozen_at: null,
    frozen_deviation_pct: null,
    min_shipping_price_cents: 0,
    excluded_at: null,
    channel_active_for_offer: true,
    ...overrides,
  };
}

/**
 * Build a default customerMarketplace row. All preconditions pass by default.
 * @param {object} [overrides]
 */
function makeMarketplace (overrides = {}) {
  return {
    id: 'cm-test-uuid',
    cron_state: 'ACTIVE',
    max_discount_pct: 0.05,
    max_increase_pct: 0.10,
    edge_step_cents: 1,
    anomaly_threshold_pct: null,
    offer_prices_decimals: 2,
    shop_name: 'Easy - Store',
    ...overrides,
  };
}

/** Minimal mock tx — decide.js receives it but should not call writeAuditEvent directly. */
const mockTx = { query: async () => ({ rows: [], rowCount: 0 }) };

const OWN_SHOP_NAME = 'Easy - Store';

// ---------------------------------------------------------------------------
// Lazy import helper — decide.js may not exist yet at ATDD authoring time.
// Tests will fail with a clear import error if the file is missing.
// ---------------------------------------------------------------------------
let _decide;
async function getDecide () {
  if (!_decide) {
    _decide = await import('../../../worker/src/engine/decide.js');
  }
  return _decide;
}

// ---------------------------------------------------------------------------
// AC4 — All 12 Story-7.2 P11 fixtures pass
// ---------------------------------------------------------------------------

describe('Story 7.2 — decideForSkuChannel: 12 P11 fixtures (AC4)', () => {

  // Fixture 1: p11-tier1-undercut-succeeds
  // Own at €31.99 (position 2); competitor at €28.50; floor=ceil(3000*0.95)=2850; targetUndercut=2849; candidate=2849<2850? No. candidate=max(2849,2850)=2850... wait.
  // Actually with default makeMarketplace (max_discount_pct=0.05): floor=ceil(3000*0.95)=ceil(2850)=2850.
  // targetUndercut=2850-1=2849, candidate=max(2849,2850)=2850, candidate(2850)>=competitorLowest(2850)? No, competitorLowest=2850.
  // 2850 >= 2850 → HOLD? No — the fixture note says UNDERCUT with newPriceCents=2849.
  // We need floor to be < competitorLowest. Use max_discount_pct=0.15: floor=ceil(3000*0.85)=ceil(2550)=2550.
  // targetUndercut=2850-1=2849; candidate=max(2849,2550)=2849; candidate(2849)<competitorLowest(2850) → UNDERCUT ✓.
  test('fixture_1_tier1_undercut_succeeds', async () => {
    const { decideForSkuChannel } = await getDecide();
    const fixture = loadFixture('p11-tier1-undercut-succeeds.json');
    const offers = fixture.products[0].offers;

    const skuChannel = makeSkuChannel({
      list_price_cents: 3000,
      current_price_cents: 3199,
      min_shipping_price_cents: 0,
    });
    // Use max_discount_pct=0.15 so floor=ceil(3000*0.85)=2550, allowing undercut at 2849
    const marketplace = makeMarketplace({ max_discount_pct: 0.15, edge_step_cents: 1 });

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: offers,
      tx: mockTx,
    });

    assert.equal(result.action, 'UNDERCUT', `Expected UNDERCUT; got ${result.action}. reason=${result.reason}`);
    assert.equal(result.newPriceCents, 2849, `Expected newPriceCents=2849 (competitorLowest-edge_step=2850-1); got ${result.newPriceCents}`);
    assert.ok(
      result.auditEvents.includes('undercut-decision'),
      `auditEvents must include 'undercut-decision'; got ${JSON.stringify(result.auditEvents)}`,
    );
    assert.notEqual(result.newPriceCents, null, 'UNDERCUT must have non-null newPriceCents');
  });

  // Fixture 2: p11-tier1-floor-bound-hold
  // Competitors at €21.00 (2100). floor=ceil(3000*0.90)=2700. targetUndercut=2099, candidate=max(2099,2700)=2700>2100 → HOLD
  test('fixture_2_tier1_floor_bound_hold', async () => {
    const { decideForSkuChannel } = await getDecide();
    const fixture = loadFixture('p11-tier1-floor-bound-hold.json');
    const offers = fixture.products[0].offers;

    const skuChannel = makeSkuChannel({
      list_price_cents: 3000,
      current_price_cents: 2400,
      min_shipping_price_cents: 0,
    });
    // max_discount_pct=0.10 → floor=ceil(3000*0.90)=2700 > competitorLowest=2100 → HOLD
    const marketplace = makeMarketplace({ max_discount_pct: 0.10, edge_step_cents: 1 });

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: offers,
      tx: mockTx,
    });

    assert.equal(result.action, 'HOLD', `Expected HOLD (floor-bound); got ${result.action}`);
    assert.equal(result.newPriceCents, null, 'HOLD must have null newPriceCents');
    assert.ok(
      result.auditEvents.includes('hold-floor-bound'),
      `auditEvents must include 'hold-floor-bound'; got ${JSON.stringify(result.auditEvents)}`,
    );
  });

  // Fixture 3: p11-tier1-tie-with-competitor-hold (AC3)
  // competitorLowest=2850; max_discount_pct=0.0 → floor=ceil(2850*1.0)=2850; edge_step=1;
  // targetUndercut=2849; candidate=max(2849,2850)=2850; candidate===competitorLowest → HOLD per pre-locked decision
  test('fixture_3_tier1_tie_with_competitor_hold_ac3', async () => {
    const { decideForSkuChannel } = await getDecide();
    const fixture = loadFixture('p11-tier1-tie-with-competitor-hold.json');
    const offers = fixture.products[0].offers;

    const skuChannel = makeSkuChannel({
      list_price_cents: 2850,
      current_price_cents: 3199,
      min_shipping_price_cents: 0,
    });
    // max_discount_pct=0.0 → floor=ceil(2850*1.0)=2850 === competitorLowest=2850
    const marketplace = makeMarketplace({ max_discount_pct: 0.0, edge_step_cents: 1 });

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: offers,
      tx: mockTx,
    });

    assert.equal(result.action, 'HOLD', `Expected HOLD (tie → pre-locked decision: do not undercut into tie); got ${result.action}`);
    assert.equal(result.newPriceCents, null, 'HOLD must have null newPriceCents');
    assert.ok(
      result.auditEvents.includes('hold-floor-bound'),
      `Tie case must emit 'hold-floor-bound' (not undercut-decision); got ${JSON.stringify(result.auditEvents)}`,
    );
  });

  // Fixture 4: p11-tier2b-ceiling-raise-headroom
  // Position 1 (own=2849, min_shipping=0; competitor1=2849 self→filtered; competitor_ranked[0]=3500).
  // Actually: own offer filtered → competitors=[3500]. own total=2849 <= 3500 → position=1.
  // competitor2nd=null → HOLD? No — wait, fixture has 2 offers: Easy-Store(2849) + CompetitorB(3500).
  // After self-filter: filteredOffers=[{3500}]. filteredOffers[0]=3500(1st), filteredOffers[1]=undefined(null).
  // position=1 (ownTotal=2849<=3500). No 2nd → HOLD + hold-already-in-1st.
  // Need to redesign: use current_price_cents LESS than own total, and 2nd competitor available.
  // Let own current=2849; competitors ranked after filter: compA=3500, compB=4000.
  // ownTotal=2849+0=2849<=3500→position=1. competitor2nd=4000. targetCeiling=4000-1=3999.
  // ceiling=floor(3000*1.10)=3300. newCeiling=min(3999,3300)=3300. 3300>2849 → CEILING_RAISE.
  test('fixture_4_tier2b_ceiling_raise_headroom', async () => {
    const { decideForSkuChannel } = await getDecide();
    const fixture = loadFixture('p11-tier2b-ceiling-raise-headroom.json');
    const offers = fixture.products[0].offers;

    // own offer at 28.49 in fixture → filtered. Competitors: [35.00]. Only 1 competitor → no 2nd.
    // Use current_price lower than competitor to be position 1 but add a 2nd competitor via different setup.
    // The fixture has only [Easy-Store(28.49), CompetitorB(35.00)].
    // After self-filter: filteredOffers=[{35.00}]. ownTotal=2849<=3500 → pos=1, no 2nd → HOLD.
    // Instead we need the fixture to work differently — we position the skuChannel
    // with current_price_cents=2849, BELOW competitor after filtering.
    // Since there is no 2nd competitor in the fixture, let's re-check: the test
    // should use a custom offers array or the fixture as-is but accept the HOLD+already-in-1st result.
    // Per story spec fixture 4: "current_price €28.49; competitor 2nd at €35.00; ceiling €30.00 → CEILING_RAISE"
    // This means the fixture must have 2 competitors AFTER filtering. The fixture has Easy-Store+CompetitorB.
    // After filtering: only CompetitorB(35.00). That's 1 competitor = 1st place = no 2nd → HOLD.
    // The spec intends: after filtering there's CompetitorB(35.00) as rank1 AND another competitor as rank2.
    // The fixture needs a 3rd party. But the fixture file only has 2 entries.
    // We override: use the raw offers + append a 2nd competitor in the test.
    const augmentedOffers = [
      ...offers,
      { shop_name: 'Competitor C', active: true, total_price: 40.00, shop_id: null },
    ];

    const skuChannel = makeSkuChannel({
      list_price_cents: 3000,
      current_price_cents: 2849,
      min_shipping_price_cents: 0,
    });
    // ceiling=floor(3000*1.10)=3300. competitor1=3500, competitor2=4000. targetCeiling=4000-1=3999.
    // newCeiling=min(3999,3300)=3300. 3300>2849 → CEILING_RAISE(3300).
    const marketplace = makeMarketplace({ max_discount_pct: 0.05, max_increase_pct: 0.10, edge_step_cents: 1 });

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: augmentedOffers,
      tx: mockTx,
    });

    assert.equal(result.action, 'CEILING_RAISE', `Expected CEILING_RAISE; got ${result.action}. reason=${result.reason}`);
    assert.equal(result.newPriceCents, 3300, `Expected newPriceCents=3300 (capped at ceiling); got ${result.newPriceCents}`);
    assert.ok(
      result.auditEvents.includes('ceiling-raise-decision'),
      `auditEvents must include 'ceiling-raise-decision'; got ${JSON.stringify(result.auditEvents)}`,
    );
  });

  // Fixture 5: p11-all-competitors-below-floor
  // competitors=[20.00, 22.00]; floor=ceil(3000*0.95)=2850; current=2800; ownTotal=2800>2000 → pos>1.
  // targetUndercut=1999; candidate=max(1999,2850)=2850; 2850>2000 → HOLD + hold-floor-bound.
  test('fixture_5_all_competitors_below_floor', async () => {
    const { decideForSkuChannel } = await getDecide();
    const fixture = loadFixture('p11-all-competitors-below-floor.json');
    const offers = fixture.products[0].offers;

    const skuChannel = makeSkuChannel({
      list_price_cents: 3000,
      current_price_cents: 2800,
      min_shipping_price_cents: 0,
    });
    // floor=ceil(3000*0.95)=2850 > competitorLowest=2000 → floor-bound HOLD
    const marketplace = makeMarketplace({ max_discount_pct: 0.05, edge_step_cents: 1 });

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: offers,
      tx: mockTx,
    });

    assert.equal(result.action, 'HOLD', `Expected HOLD (all competitors below floor); got ${result.action}`);
    assert.equal(result.newPriceCents, null, 'HOLD must have null newPriceCents');
    assert.ok(
      result.auditEvents.includes('hold-floor-bound'),
      `auditEvents must include 'hold-floor-bound'; got ${JSON.stringify(result.auditEvents)}`,
    );
  });

  // Fixture 6: p11-all-competitors-above-ceiling
  // Self filtered out. Remaining competitors: [40.00, 45.00]. own current=2800+0=2800<=4000 → position=1.
  // competitor2nd=4500. ceiling=floor(3000*1.10)=3300. targetCeiling=4500-1=4499. newCeiling=min(4499,3300)=3300.
  // 3300>2800 → CEILING_RAISE(3300).
  test('fixture_6_all_competitors_above_ceiling', async () => {
    const { decideForSkuChannel } = await getDecide();
    const fixture = loadFixture('p11-all-competitors-above-ceiling.json');
    const offers = fixture.products[0].offers;

    const skuChannel = makeSkuChannel({
      list_price_cents: 3000,
      current_price_cents: 2800,
      min_shipping_price_cents: 0,
    });
    // ceiling=floor(3000*1.10)=3300; competitor1=4000, competitor2=4500; newCeiling=min(4499,3300)=3300>2800 → CEILING_RAISE
    const marketplace = makeMarketplace({ max_discount_pct: 0.05, max_increase_pct: 0.10, edge_step_cents: 1 });

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: offers,
      tx: mockTx,
    });

    // Per fixture _expected: action='CEILING_RAISE', newPriceCents=3300 (capped at ceiling).
    // The fixture data is unambiguous: own at 2800 (position 1), competitors at 4000 + 4500;
    // ceiling = floor(3000*1.10) = 3300; newCeiling = min(4499, 3300) = 3300 > 2800 → CEILING_RAISE.
    assert.equal(result.action, 'CEILING_RAISE', `Expected CEILING_RAISE (capped at ceiling); got ${result.action}. reason=${result.reason}`);
    assert.equal(result.newPriceCents, 3300, `Expected newPriceCents=3300 (capped at ceiling); got ${result.newPriceCents}`);
    assert.ok(
      result.auditEvents.includes('ceiling-raise-decision'),
      `auditEvents must include 'ceiling-raise-decision'; got ${JSON.stringify(result.auditEvents)}`,
    );
  });

  // Fixture 7: p11-self-active-in-p11
  // Own offer (28.49) in P11 as active → filtered by shop_name. Remaining: [Competitor A: 29.50].
  // ownTotal=2849+0=2849 <= 2950 → position=1 (we're cheaper). No 2nd → HOLD + hold-already-in-1st.
  test('fixture_7_self_active_in_p11_correctly_filtered', async () => {
    const { decideForSkuChannel } = await getDecide();
    const fixture = loadFixture('p11-self-active-in-p11.json');
    const offers = fixture.products[0].offers;

    const skuChannel = makeSkuChannel({
      list_price_cents: 3000,
      current_price_cents: 2849,
      min_shipping_price_cents: 0,
    });
    const marketplace = makeMarketplace({ max_discount_pct: 0.05, max_increase_pct: 0.10, edge_step_cents: 1 });

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: offers,
      tx: mockTx,
    });

    // After self-filter: [Competitor A: 29.50]. Own position = 1 (2849 <= 2950). No 2nd → HOLD.
    assert.equal(result.action, 'HOLD', `Expected HOLD (position 1, no 2nd competitor); got ${result.action}`);
    assert.ok(
      result.auditEvents.includes('hold-already-in-1st'),
      `auditEvents must include 'hold-already-in-1st' when in position 1 with no 2nd; got ${JSON.stringify(result.auditEvents)}`,
    );
    // Verify own offer was filtered (not ranked as competitor) — if own offer leaked, position math would be wrong
    assert.equal(result.newPriceCents, null, 'HOLD must have null newPriceCents');
  });

  // Fixture 8: p11-self-marked-inactive-but-returned
  // Own offer returned with active=false. AD14 active===true filter catches it first.
  // After filtering: [Competitor A:25.00, Competitor B:30.00]. ownTotal=3199+0=3199>2500 → pos>1.
  // floor=ceil(3000*0.95)=2850. targetUndercut=2499; candidate=max(2499,2850)=2850>2500 → HOLD + hold-floor-bound.
  test('fixture_8_self_inactive_offer_filtered_by_active_check', async () => {
    const { decideForSkuChannel } = await getDecide();
    const fixture = loadFixture('p11-self-marked-inactive-but-returned.json');
    const offers = fixture.products[0].offers;

    const skuChannel = makeSkuChannel({
      list_price_cents: 3000,
      current_price_cents: 3199,
      min_shipping_price_cents: 0,
    });
    // floor=ceil(3000*0.95)=2850 > competitorLowest=2500 → HOLD + hold-floor-bound
    const marketplace = makeMarketplace({ max_discount_pct: 0.05, edge_step_cents: 1 });

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: offers,
      tx: mockTx,
    });

    assert.equal(result.action, 'HOLD', `Expected HOLD (inactive own offer filtered; floor-bound); got ${result.action}`);
    assert.ok(
      result.auditEvents.includes('hold-floor-bound'),
      `auditEvents must include 'hold-floor-bound'; got ${JSON.stringify(result.auditEvents)}`,
    );
    // Verify the active filter worked: if inactive own offer leaked past active===true filter,
    // and it was ranked as a competitor, the ranking would be wrong.
    // The hold-floor-bound confirms competitor at 2500 was used for ranking (floor 2850 > 2500).
  });

  // Fixture 9: p11-single-competitor-is-self
  // Only own shop offer; after self-filter: filteredOffers.length===0 → Tier 3 path.
  // Expected: HOLD + tier-transition.
  test('fixture_9_single_competitor_is_self_tier3_path', async () => {
    const { decideForSkuChannel } = await getDecide();
    const fixture = loadFixture('p11-single-competitor-is-self.json');
    const offers = fixture.products[0].offers;

    const skuChannel = makeSkuChannel();
    const marketplace = makeMarketplace();

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: offers,
      tx: mockTx,
    });

    assert.equal(result.action, 'HOLD', `Expected HOLD (no competitors after filter → Tier 3); got ${result.action}`);
    assert.equal(result.reason, 'no-competitors', `Expected reason='no-competitors'; got '${result.reason}'`);
    assert.ok(
      result.auditEvents.includes('tier-transition'),
      `auditEvents must include 'tier-transition' for Tier 3 / no-competitors path; got ${JSON.stringify(result.auditEvents)}`,
    );
    assert.equal(result.newPriceCents, null, 'HOLD must have null newPriceCents');
  });

  // Fixture 10: p11-zero-price-placeholder-mixed-in
  // Strawberrynet(0) filtered by total_price>0. Remaining: [Competitor A:29.00].
  // ownTotal=3199+0=3199>2900 → pos>1. floor=ceil(3000*0.95)=2850. targetUndercut=2899; candidate=max(2899,2850)=2899<2900 → UNDERCUT(2899).
  test('fixture_10_zero_price_placeholder_filtered', async () => {
    const { decideForSkuChannel } = await getDecide();
    const fixture = loadFixture('p11-zero-price-placeholder-mixed-in.json');
    const offers = fixture.products[0].offers;

    const skuChannel = makeSkuChannel({
      list_price_cents: 3000,
      current_price_cents: 3199,
      min_shipping_price_cents: 0,
    });
    // floor=ceil(3000*0.95)=2850; competitorLowest(after zero filtered)=2900; targetUndercut=2899; candidate=max(2899,2850)=2899<2900 → UNDERCUT
    const marketplace = makeMarketplace({ max_discount_pct: 0.05, edge_step_cents: 1 });

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: offers,
      tx: mockTx,
    });

    assert.equal(result.action, 'UNDERCUT', `Expected UNDERCUT (zero-price filtered, competitor at 29.00 used); got ${result.action}`);
    assert.equal(result.newPriceCents, 2899, `Expected newPriceCents=2899; got ${result.newPriceCents}`);
    assert.ok(
      result.auditEvents.includes('undercut-decision'),
      `auditEvents must include 'undercut-decision'; got ${JSON.stringify(result.auditEvents)}`,
    );
  });

  // Fixture 11: p11-shop-name-collision
  // Two offers with shop_name==='Easy - Store'. AD13 collision → SKIP + shop-name-collision-detected.
  test('fixture_11_shop_name_collision_skip', async () => {
    const { decideForSkuChannel } = await getDecide();
    const fixture = loadFixture('p11-shop-name-collision.json');
    const offers = fixture.products[0].offers;

    const skuChannel = makeSkuChannel();
    const marketplace = makeMarketplace();

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: offers,
      tx: mockTx,
    });

    assert.equal(result.action, 'SKIP', `Expected SKIP (collision detected); got ${result.action}`);
    assert.equal(result.newPriceCents, null, 'SKIP must have null newPriceCents');
    assert.ok(
      result.auditEvents.includes('shop-name-collision-detected'),
      `auditEvents must include 'shop-name-collision-detected' (Atenção); got ${JSON.stringify(result.auditEvents)}`,
    );
  });

  // Fixture 12: p11-pri01-pending-skip
  // pending_import_id is set → precondition #4 fails → SKIP + no audit events.
  test('fixture_12_pri01_pending_skip_precondition', async () => {
    const { decideForSkuChannel } = await getDecide();
    const fixture = loadFixture('p11-pri01-pending-skip.json');
    const offers = fixture.products[0].offers;

    const skuChannel = makeSkuChannel({
      pending_import_id: 'import-uuid-in-flight',  // non-null → precondition #4 fails
    });
    const marketplace = makeMarketplace();

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: offers,
      tx: mockTx,
    });

    assert.equal(result.action, 'SKIP', `Expected SKIP (pending_import_id set); got ${result.action}`);
    assert.equal(result.newPriceCents, null, 'SKIP must have null newPriceCents');
    assert.deepEqual(result.auditEvents, [], `Expected empty auditEvents for pending-import SKIP; got ${JSON.stringify(result.auditEvents)}`);
  });

});

// ---------------------------------------------------------------------------
// AC1 — Precondition checks (belt-and-suspenders tests for each precondition)
// ---------------------------------------------------------------------------

describe('Story 7.2 — decideForSkuChannel: preconditions (AC1)', () => {

  const baseOffers = [
    { shop_name: 'Competitor A', active: true, total_price: 28.50, shop_id: null },
    { shop_name: 'Easy - Store', active: true, total_price: 31.99, shop_id: null },
  ];

  test('precondition_cron_state_not_active_returns_skip', async () => {
    const { decideForSkuChannel } = await getDecide();
    const result = await decideForSkuChannel({
      skuChannel: makeSkuChannel(),
      customerMarketplace: makeMarketplace({ cron_state: 'PAUSED' }),
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: baseOffers,
      tx: mockTx,
    });
    assert.equal(result.action, 'SKIP', 'cron_state !== ACTIVE must return SKIP');
    assert.deepEqual(result.auditEvents, [], 'precondition SKIP must have empty auditEvents');
  });

  test('precondition_frozen_for_anomaly_review_returns_skip', async () => {
    const { decideForSkuChannel } = await getDecide();
    const result = await decideForSkuChannel({
      skuChannel: makeSkuChannel({ frozen_for_anomaly_review: true }),
      customerMarketplace: makeMarketplace(),
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: baseOffers,
      tx: mockTx,
    });
    assert.equal(result.action, 'SKIP', 'frozen_for_anomaly_review=true must return SKIP');
  });

  test('precondition_frozen_for_pri01_persistent_returns_skip', async () => {
    const { decideForSkuChannel } = await getDecide();
    const result = await decideForSkuChannel({
      skuChannel: makeSkuChannel({ frozen_for_pri01_persistent: true }),
      customerMarketplace: makeMarketplace(),
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: baseOffers,
      tx: mockTx,
    });
    assert.equal(result.action, 'SKIP', 'frozen_for_pri01_persistent=true (Story 6.3 Option b) must return SKIP');
  });

  test('precondition_excluded_at_set_returns_skip', async () => {
    const { decideForSkuChannel } = await getDecide();
    const result = await decideForSkuChannel({
      skuChannel: makeSkuChannel({ excluded_at: new Date().toISOString() }),
      customerMarketplace: makeMarketplace(),
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: baseOffers,
      tx: mockTx,
    });
    assert.equal(result.action, 'SKIP', 'excluded_at !== null must return SKIP');
  });

});

// ---------------------------------------------------------------------------
// AC2 — Filter chain is mandatory and post-filter only
// ---------------------------------------------------------------------------

describe('Story 7.2 — decideForSkuChannel: filter chain post-filter only (AC2)', () => {

  test('engine_uses_filteredOffers_only_after_self_filter', async () => {
    const { decideForSkuChannel } = await getDecide();

    // Setup where zero-price + inactive + own offer all appear in raw; only one valid competitor left.
    // The result must reflect only the valid competitor (29.00), not the raw 28.00 (inactive) or 0 (zero).
    const rawOffers = [
      { shop_name: 'Competitor A', active: false, total_price: 10.00, shop_id: null },  // filtered (inactive)
      { shop_name: 'Zero Corp',    active: true,  total_price: 0,     shop_id: null },  // filtered (zero price)
      { shop_name: 'Easy - Store', active: true,  total_price: 28.49, shop_id: null },  // filtered (own shop)
      { shop_name: 'Competitor B', active: true,  total_price: 29.00, shop_id: null },  // VALID: lowest after filter
    ];

    const skuChannel = makeSkuChannel({
      list_price_cents: 3000,
      current_price_cents: 3199,
      min_shipping_price_cents: 0,
    });
    // floor=ceil(3000*0.95)=2850; competitorLowest=2900; targetUndercut=2899; candidate=max(2899,2850)=2899<2900 → UNDERCUT(2899)
    const marketplace = makeMarketplace({ max_discount_pct: 0.05, edge_step_cents: 1 });

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: rawOffers,
      tx: mockTx,
    });

    assert.equal(result.action, 'UNDERCUT', `Expected UNDERCUT based on valid competitor at 29.00; got ${result.action}`);
    assert.equal(result.newPriceCents, 2899, `Expected newPriceCents=2899 (only Competitor B:2900 used); got ${result.newPriceCents}`);
  });

  test('filter_order_active_then_price_then_own_shop', async () => {
    const { decideForSkuChannel } = await getDecide();

    // Own offer with active=false AND total_price=0 — both filters would catch it.
    // AD14 active===true is first; the shop_name filter is third.
    // Result should not differ functionally, but we verify the outcome is correct.
    const rawOffers = [
      { shop_name: 'Easy - Store', active: false, total_price: 0,     shop_id: null },  // filtered by active AND price
      { shop_name: 'Competitor A', active: true,  total_price: 30.00, shop_id: null },
    ];

    const skuChannel = makeSkuChannel({
      list_price_cents: 3000,
      current_price_cents: 3199,
      min_shipping_price_cents: 0,
    });
    // competitorLowest=3000; floor=ceil(3000*0.95)=2850; targetUndercut=2999; candidate=max(2999,2850)=2999<3000 → UNDERCUT(2999)
    const marketplace = makeMarketplace({ max_discount_pct: 0.05, edge_step_cents: 1 });

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: rawOffers,
      tx: mockTx,
    });

    assert.equal(result.action, 'UNDERCUT', `Expected UNDERCUT; got ${result.action}`);
    assert.equal(result.newPriceCents, 2999, `Expected 2999 (competitor 30.00 - edge_step 1 = 2999); got ${result.newPriceCents}`);
  });

});

// ---------------------------------------------------------------------------
// AC1 — STEP 4 CASE B: winning position — no 2nd competitor
// ---------------------------------------------------------------------------

describe('Story 7.2 — decideForSkuChannel: CASE B position 1 branching (AC1)', () => {

  test('position_1_no_2nd_competitor_returns_hold_already_in_1st', async () => {
    const { decideForSkuChannel } = await getDecide();

    const rawOffers = [
      { shop_name: 'Easy - Store', active: true, total_price: 28.49, shop_id: null },
      { shop_name: 'Competitor A', active: true, total_price: 35.00, shop_id: null },
    ];

    const skuChannel = makeSkuChannel({
      current_price_cents: 2849,
      min_shipping_price_cents: 0,
    });
    // After self-filter: [Competitor A: 3500]. ownTotal=2849<=3500 → position=1. No 2nd → HOLD.
    const marketplace = makeMarketplace();

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: rawOffers,
      tx: mockTx,
    });

    assert.equal(result.action, 'HOLD', `Expected HOLD (position 1, no 2nd competitor); got ${result.action}`);
    assert.ok(
      result.auditEvents.includes('hold-already-in-1st'),
      `auditEvents must include 'hold-already-in-1st'; got ${JSON.stringify(result.auditEvents)}`,
    );
  });

  test('position_1_with_2nd_but_ceiling_prevents_raise_returns_hold', async () => {
    const { decideForSkuChannel } = await getDecide();

    // Scenario: position 1 but already at ceiling — newCeiling === current_price_cents → HOLD.
    // own current=3150; competitor1=3200; competitor2=3500; ownTotal=3150<3200 → pos=1.
    // ceiling=floor(3000*1.05)=3150. targetCeiling=3500-1=3499. newCeiling=min(3499,3150)=3150.
    // 3150 > 3150? No → HOLD + hold-already-in-1st.
    const skuChannel = makeSkuChannel({
      list_price_cents: 3000,
      current_price_cents: 3150,
      min_shipping_price_cents: 0,
    });
    const rawOffers = [
      { shop_name: 'Easy - Store', active: true, total_price: 31.50, shop_id: null },
      { shop_name: 'Competitor A', active: true, total_price: 32.00, shop_id: null },
      { shop_name: 'Competitor B', active: true, total_price: 35.00, shop_id: null },
    ];
    const marketplace = makeMarketplace({ max_discount_pct: 0.05, max_increase_pct: 0.05, edge_step_cents: 1 });

    const result = await decideForSkuChannel({
      skuChannel,
      customerMarketplace: marketplace,
      ownShopName: OWN_SHOP_NAME,
      p11RawOffers: rawOffers,
      tx: mockTx,
    });

    assert.equal(result.action, 'HOLD', `Expected HOLD (already at ceiling); got ${result.action}`);
    assert.ok(
      result.auditEvents.includes('hold-already-in-1st'),
      `auditEvents must include 'hold-already-in-1st' when ceiling prevents raise; got ${JSON.stringify(result.auditEvents)}`,
    );
  });

});

// ---------------------------------------------------------------------------
// AC5 — Negative assertions (structural — no raw p11RawOffers reads after filter,
//        no float math, no writeAuditEvent call in decide.js source)
// ---------------------------------------------------------------------------

describe('Story 7.2 — decideForSkuChannel: structural negative assertions (AC5)', () => {

  test('decide_js_does_not_call_writeAuditEvent_directly', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('worker/src/engine/decide.js', 'utf8');

    assert.ok(
      !source.includes('writeAuditEvent('),
      "decide.js must NOT call writeAuditEvent() directly — audit events returned in auditEvents[] array for caller (cycle-assembly) to emit",
    );
  });

  test('decide_js_does_not_use_console_log', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('worker/src/engine/decide.js', 'utf8');

    assert.ok(
      !source.includes('console.log('),
      "decide.js must use pino logger, not console.log",
    );
  });

  test('decide_js_does_not_have_raw_insert_into_audit_log', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('worker/src/engine/decide.js', 'utf8');

    assert.ok(
      !source.toLowerCase().includes('insert into audit_log'),
      "decide.js must NOT do raw INSERT INTO audit_log — use writeAuditEvent (which returns via auditEvents[] to caller)",
    );
  });

  test('decide_js_does_not_update_cron_state_directly', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('worker/src/engine/decide.js', 'utf8');

    assert.ok(
      !source.toLowerCase().includes('update customer_marketplaces set cron_state'),
      "decide.js must NOT directly UPDATE customer_marketplaces SET cron_state — use transitionCronState",
    );
  });

  test('decide_js_passes_node_check_syntax_validation', async () => {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    try {
      await execFileAsync('node', ['--check', 'worker/src/engine/decide.js']);
    } catch (err) {
      assert.fail(`node --check failed on decide.js: ${err.stderr || err.message}`);
    }
  });

  // AC5 — Zero matches for p11RawOffers used after the filterCompetitorOffers call line.
  // Only the call site itself passes raw offers to the filter; all post-filter ranking
  // must use filteredOffers exclusively.
  test('decide_js_does_not_read_p11RawOffers_after_filter_call', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('worker/src/engine/decide.js', 'utf8');
    const lines = source.split('\n');

    // Locate the filterCompetitorOffers call site
    const filterCallLineIndex = lines.findIndex(line => line.includes('filterCompetitorOffers(p11RawOffers'));
    assert.ok(filterCallLineIndex !== -1, 'decide.js must call filterCompetitorOffers(p11RawOffers, ...)');

    // Scan executable lines after the filter call for any p11RawOffers reference.
    // Strip line comments before matching so docstrings/notes about the variable
    // (e.g. the "p11RawOffers is never read again past this point" comment) do not
    // trigger a false positive.
    const stripLineComment = (line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    };

    const violations = [];
    for (let i = filterCallLineIndex + 1; i < lines.length; i++) {
      const code = stripLineComment(lines[i]);
      if (/\bp11RawOffers\b/.test(code)) {
        violations.push(`line ${i + 1}: ${lines[i].trim()}`);
      }
    }

    assert.equal(
      violations.length,
      0,
      `decide.js must NOT read p11RawOffers after the filter call (Engine Law: post-filter only); found:\n${violations.join('\n')}`,
    );
  });

  // AC5 — Belt-and-suspenders grep for float-price math (no-float-price ESLint rule
  // is the primary enforcement; this grep is the redundant structural confirmation).
  test('decide_js_has_no_float_price_math_patterns', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile('worker/src/engine/decide.js', 'utf8');

    // Strip block + line comments and JSDoc so commentary mentioning these tokens
    // (e.g. "use toCents instead of * 100") does not trigger false positives.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map(line => {
        const idx = line.indexOf('//');
        return idx === -1 ? line : line.slice(0, idx);
      })
      .join('\n');

    const forbidden = ['.toFixed(2)', 'parseFloat(', '* 100', '/ 100'];
    const found = forbidden.filter(token => stripped.includes(token));

    assert.deepEqual(
      found,
      [],
      `decide.js must NOT contain float-price math tokens (no-float-price); found: ${JSON.stringify(found)}`,
    );
  });

});
