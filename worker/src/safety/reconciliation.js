// worker/src/safety/reconciliation.js
//
// safe: cross-customer cron — FR28 Tier-3 nightly-reconciliation backstop.
// Iterates ALL customers' Tier 3 sku_channels in a single daily pass.
// Not subject to the worker-must-filter-by-customer ESLint rule for the
// top-level SELECT (cross-customer is the explicit FR28 contract). All
// subsequent writes (UPDATE sku_channels, writeAuditEvent) carry the
// row's customer_marketplace_id — per-customer scope preserved there.
//
// Story 7.7 — SSoT module for FR28 + AD10 Tier-3 nightly-reconciliation.
//
// Architecture:
//   - Pattern A (NOT Pattern C like tier-classify.js): reconciliation is a
//     STANDALONE cron, not inside decide.js. It imports writeAuditEvent
//     directly and emits tier-transition + new-competitor-entered INLINE.
//   - Path I autocommit-per-statement (SCP-2026-05-13): each await tx.query()
//     and each await writeAuditEvent() autocommits at its own boundary.
//     No BEGIN/COMMIT framing — reconciliation inherits the Story 7.4/7.5/7.6
//     autocommit-equivalence precedent.
//   - Cross-customer SELECT: carries dual pragma (file-top comment block +
//     inline // safe: cross-customer cron comment above SELECT) per
//     Constraint #24 (worker-must-filter-by-customer).
//
// Constraint compliance:
//   no-console (Constraint #18): pino only via logger parameter.
//   no-direct-fetch — Constraint #19: all HTTP via getProductOffersByEan SSoT.
//   no-raw-INSERT-audit-log (Constraint #21): all audit via writeAuditEvent.
//   no-float-price (Constraint #22): toCents() at P11 boundary.
//   worker-must-filter-by-customer (Constraint #24): dual pragma.
//   no-default-export: only named exports.
//   no .then() chains: async/await only.
//
// Reference SSoT pattern: worker/src/safety/anomaly-freeze.js (Pattern A —
// UPDATE + writeAuditEvent inline in caller-supplied tx, named exports, JSDoc
// typedefs, pino logger). Reconciliation deviates ONLY by: (a) cross-customer
// iteration, (b) being a cron entry point, (c) Constraint #24 dual pragma.
//
// Canonical payload shapes emitted by this module (Story 7.7 is the FIRST
// production module to emit these correctly):
//   PayloadForTierTransition       (shared/audit/event-types.js:260-264)
//   PayloadForNewCompetitorEntered (shared/audit/event-types.js:160-164)
//
// Authorized callers: worker/src/jobs/reconciliation.js (cron entry) ONLY.
// If a future story needs to trigger reconciliation from elsewhere, surface
// to Pedro first.

import { randomUUID } from 'node:crypto';
import { applyTierClassification } from '../engine/tier-classify.js';
import { getProductOffersByEan } from '../../../shared/mirakl/p11.js';
import { filterCompetitorOffers } from '../../../shared/mirakl/self-filter.js';
import { writeAuditEvent } from '../../../shared/audit/writer.js';
import { EVENT_TYPES } from '../../../shared/audit/event-types.js';
import { toCents } from '../../../shared/money/index.js';
import { decryptShopApiKey } from '../../../shared/crypto/envelope.js';
import { loadMasterKey } from '../../../shared/crypto/master-key-loader.js';

// Master key is held in worker-process memory only (AD3). Loaded once per
// process (lazy on first reconciliation pass). Pattern matches
// worker/src/jobs/onboarding-scan.js:48-51 + pri02-poll.js:31-34.
// Fail-fast at boot if MASTER_KEY_BASE64 is missing (index.js already aborts
// on loadMasterKey() failure, so this lazy pattern is belt-and-suspenders for
// any future direct invocation path).
let _cachedMasterKey = null;
function getMasterKey () {
  if (_cachedMasterKey === null) {
    _cachedMasterKey = loadMasterKey();
  }
  return _cachedMasterKey;
}

// ---------------------------------------------------------------------------
// SQL — cross-customer T3 sweep
// ---------------------------------------------------------------------------
//
// SELECT all Tier 3 sku_channels regardless of customer — the entire purpose
// of FR28 is to sweep ALL customers' T3 rows nightly (backstop guarantee).
// No last_checked_at predicate — reconciliation promises exhaustive Tier-3
// coverage; adding a filter would defeat the daily-pass guarantee.
// JOIN skus for EAN (P11 call param) + shop_api_key_vault + customer_marketplaces
// for per-row API credentials and baseUrl.
const RECONCILIATION_SQL = `
SELECT
  sc.id,
  sc.sku_id,
  sc.customer_marketplace_id,
  sc.channel_code,
  sc.tier,
  sc.tier_cadence_minutes,
  sc.last_won_at,
  sc.last_checked_at,
  sc.list_price_cents,
  sc.current_price_cents,
  sc.min_shipping_price_cents,
  s.ean,
  cm.shop_name,
  cm.marketplace_instance_url AS base_url,
  v.ciphertext AS shop_api_key_ciphertext,
  v.nonce AS shop_api_key_nonce,
  v.auth_tag AS shop_api_key_auth_tag
FROM sku_channels sc
JOIN skus s ON s.id = sc.sku_id
JOIN customer_marketplaces cm ON cm.id = sc.customer_marketplace_id
JOIN shop_api_key_vault v ON v.customer_marketplace_id = sc.customer_marketplace_id
WHERE sc.tier = '3'
  AND sc.frozen_for_anomaly_review = false
  AND sc.frozen_for_pri01_persistent = false
  AND sc.pending_import_id IS NULL
  AND s.excluded_at IS NULL
`;

// ---------------------------------------------------------------------------
// runReconciliationPass
// ---------------------------------------------------------------------------

/**
 * @typedef {object} ReconciliationPassStats
 * @property {number} skusEvaluated       - Total T3 rows iterated
 * @property {number} tierTransitions      - Count where applyTierClassification returned tierTransitioned=true
 * @property {number} newCompetitorsDetected - Count where filteredOffers.length > 0 (subset of tierTransitions from T3)
 * @property {number} staleStateWarnings   - Count of AC3 warn-log emissions (drift > 2x cadence)
 * @property {number} durationMs           - Wall-clock duration of the full pass in milliseconds
 */

/**
 * Run one nightly Tier-3 reconciliation pass across ALL customers.
 *
 * Implements the FR28 + AD10 Tier-3 nightly-pass contract:
 *   1. SELECT all Tier 3 sku_channels (cross-customer, no last_checked_at filter)
 *   2. For each row: drift-check (AC3), P11 fetch, self-filter, collision guard,
 *      applyTierClassification, audit emissions (Pattern A — direct writeAuditEvent),
 *      last_checked_at bump.
 *   3. Return pass-summary stats.
 *
 * Tx topology — Path I autocommit-per-statement (SCP-2026-05-13):
 *   Acquires ONE PoolClient via pool.connect() and reuses it across all T3 rows.
 *   Each await client.query() and each await writeAuditEvent() autocommits at
 *   its own boundary. No per-customer advisory lock (optimistic-concurrency guard
 *   in applyTierClassification covers the master-cron race).
 *
 * @param {object}  params
 * @param {import('pg').Pool}   params.pool   - pg Pool (service-role client from cron entry)
 * @param {import('pino').Logger} params.logger - Worker-level pino logger from cron caller.
 *   Do NOT create a new logger inside this function — mirror monthly-partition-create.js:60.
 * @param {object}  [params._deps] - Optional dependency injection for unit tests.
 *   Allows overriding internal functions without dynamic-import-with-fallback in production
 *   (SCP Amendment 7 — production modules MUST use static imports; DI is test-only).
 *   - p11Fetcher: replacement for getProductOffersByEan (async fn)
 *   - selfFilter: replacement for filterCompetitorOffers (sync fn)
 *   - tierClassifier: replacement for applyTierClassification (async fn)
 *   - auditWriter: replacement for writeAuditEvent (async fn)
 *   - decryptFn: replacement for decryptShopApiKey (sync fn) — used in tests to bypass crypto
 * @returns {Promise<ReconciliationPassStats>}
 *
 * @typedef {import('../../../shared/audit/event-types.js').PayloadForTierTransition} PayloadForTierTransition
 * @typedef {import('../../../shared/audit/event-types.js').PayloadForNewCompetitorEntered} PayloadForNewCompetitorEntered
 */
export async function runReconciliationPass ({ pool, logger, _deps = null }) {
  const startMs = Date.now();

  // Dependency injection for unit tests (SCP Amendment 7 compliant: production
  // imports are STATIC above; the _deps param allows test-level override without
  // dynamic-import-with-fallback in production code).
  const p11Fetcher     = _deps?.p11Fetcher     ?? getProductOffersByEan;
  const selfFilterFn   = _deps?.selfFilter      ?? filterCompetitorOffers;
  const tierClassifier = _deps?.tierClassifier  ?? applyTierClassification;
  const auditWriter    = _deps?.auditWriter     ?? writeAuditEvent;
  const decryptFn      = _deps?.decryptFn       ?? decryptShopApiKey;

  // Per-pass UUID: used as cycleId on tier-transition + new-competitor-entered
  // audit emissions. Reconciliation is not a dispatcher cycle, so cycleId is a
  // synthetic per-pass UUID — signals "this emission came from a nightly
  // reconciliation pass" in the audit log. Dev choice: per-pass UUID (not null)
  // for better audit traceability; documented in Dev Agent Record per AC4.
  const passCycleId = randomUUID();

  let skusEvaluated = 0;
  let tierTransitions = 0;
  let newCompetitorsDetected = 0;
  let staleStateWarnings = 0;

  // Acquire ONE PoolClient for the entire pass. Released in try/finally.
  // At MVP scale (5-10 customers, ≤50k T3 SKUs), holding one client for the
  // full daily pass is acceptable. Phase 2 can refactor to per-customer client
  // acquisition if pool exhaustion surfaces.
  const client = await pool.connect();

  try {
    // safe: cross-customer cron
    const { rows } = await client.query(RECONCILIATION_SQL);

    logger.info(
      { skusToEvaluate: rows.length, passCycleId },
      'reconciliation: starting nightly Tier-3 pass',
    );

    // Sequenced iteration — NOT Promise.all. Reconciliation prioritises
    // predictable ordering over parallelism at MVP scale. With Mirakl rate
    // limits + retry-on-429, parallel fetch would exhaust API budget faster
    // than the daily 24h window can absorb. Phase 2 can add bounded-concurrency
    // batching if empirical pass duration exceeds 2h during dogfood.
    for (const row of rows) {
      skusEvaluated++;

      const skuChannelId          = row.id;
      const customerMarketplaceId = row.customer_marketplace_id;
      const skuId                 = row.sku_id;

      // -----------------------------------------------------------------------
      // AC3 — Stale-state drift detection (BEFORE P11 fetch)
      // Drift threshold: 2× tier_cadence_minutes (for T3: 2880 min = 48h).
      // Uses integer arithmetic — no float involvement.
      // -----------------------------------------------------------------------
      const lastCheckedAt = row.last_checked_at;
      const driftMs       = Date.now() - new Date(lastCheckedAt).getTime();
      const thresholdMs   = row.tier_cadence_minutes * 2 * 60 * 1000;

      if (driftMs > thresholdMs) {
        const driftMinutes = Math.floor(driftMs / 60000);
        logger.warn(
          {
            skuChannelId,
            customerMarketplaceId,
            lastCheckedAt,
            tierCadenceMinutes: row.tier_cadence_minutes,
            driftMinutes,
          },
          'reconciliation: stale-state detected — last_checked_at older than tier_cadence_minutes * 2 (dispatcher backlog suspected; reconciliation will recover this row in current pass)',
        );
        staleStateWarnings++;
        // Do NOT skip the row — the same-pass P11 call IS the recovery.
        // Do NOT emit an audit event — drift is observability, not in AD20.
      }

      // -----------------------------------------------------------------------
      // Decrypt per-row API credentials
      // Column aliases from SELECT: shop_api_key_ciphertext, shop_api_key_nonce,
      // shop_api_key_auth_tag (aliased from vault table's ciphertext, nonce, auth_tag).
      // -----------------------------------------------------------------------
      let apiKey;
      try {
        apiKey = decryptFn({
          ciphertext: row.shop_api_key_ciphertext,
          nonce:      row.shop_api_key_nonce,
          authTag:    row.shop_api_key_auth_tag,
          masterKey:  getMasterKey(),
        });
      } catch (decryptErr) {
        logger.warn(
          { skuChannelId, customerMarketplaceId, err: decryptErr.message },
          'reconciliation: failed to decrypt shop API key — skipping row',
        );
        continue;
      }

      const baseUrl     = row.base_url;
      const ean         = row.ean;
      const ownShopName = row.shop_name;

      // -----------------------------------------------------------------------
      // P11 fetch — via Story 3.2 SSoT wrapper (REUSED UNCHANGED)
      // -----------------------------------------------------------------------
      let rawOffers;
      try {
        rawOffers = await p11Fetcher(baseUrl, apiKey, {
          ean,
          channel:            row.channel_code,
          pricingChannelCode: row.channel_code,
        });
      } catch (p11Err) {
        logger.warn(
          { skuChannelId, customerMarketplaceId, ean, err: p11Err.message },
          'reconciliation: P11 fetch failed — skipping row',
        );
        continue;
      }

      // -----------------------------------------------------------------------
      // Self-filter — via Story 3.2 SSoT (REUSED UNCHANGED)
      // -----------------------------------------------------------------------
      const { filteredOffers, collisionDetected } = selfFilterFn(rawOffers, ownShopName);

      // Collision guard (AD13 defensive): own shop appeared twice in P11 results.
      // Log + skip applyTierClassification + skip audit emissions.
      // DO bump last_checked_at so the row isn't immediately retried.
      if (collisionDetected) {
        logger.warn(
          { skuChannelId, customerMarketplaceId, ownShopName },
          'reconciliation: shop-name collision detected — skipping tier classification and audit emissions for this row',
        );
        await client.query(
          'UPDATE sku_channels SET last_checked_at = NOW() WHERE id = $1',
          [skuChannelId],
        );
        continue;
      }

      // -----------------------------------------------------------------------
      // Determine currentPosition (mirror decide.js:167-169 ownTotal comparison)
      // Reconciliation does NOT need full STEP 3 floor/ceiling math — it only
      // classifies position (1 = winning, 2 = contested) for tier transitions.
      // -----------------------------------------------------------------------
      let currentPosition = null;
      if (filteredOffers.length > 0) {
        // ownTotal = our current_price_cents + min_shipping_price_cents (if any).
        // Mirror decide.js:164-169: BOTH sides of the comparison MUST be in
        // integer cents. P11's filteredOffers[0].total_price is a JSON number
        // in EUROS (per shared/mirakl/p11.js empirical contract); convert via
        // toCents() at the boundary (Constraint #22) so we compare cents-to-cents.
        // Comparing cents to euros silently misclassifies winning rows as losing
        // (e.g. our 4500c = €45 vs competitor €50 raw = 50 → buggy 4500<=50 is
        // false → currentPosition=2 → T3→T1 instead of the correct T3→T2a).
        const ownTotalCents         = (row.current_price_cents ?? 0) + (row.min_shipping_price_cents ?? 0);
        const competitorLowestCents = toCents(filteredOffers[0].total_price);
        // Position 1 if our total is ≤ lowest competitor (we are winning or tied).
        // Position 2 if our total is > lowest competitor (we are losing).
        currentPosition = ownTotalCents <= competitorLowestCents ? 1 : 2;
      }

      // -----------------------------------------------------------------------
      // applyTierClassification — Story 7.5 SSoT, second authorized caller
      // -----------------------------------------------------------------------
      const skuChannel = {
        id:                       skuChannelId,
        tier:                     row.tier,
        tier_cadence_minutes:     row.tier_cadence_minutes,
        last_won_at:              row.last_won_at,
        customer_marketplace_id:  customerMarketplaceId,
        sku_id:                   skuId,
        channel_code:             row.channel_code,
        current_price_cents:      row.current_price_cents,
        min_shipping_price_cents: row.min_shipping_price_cents,
      };

      const tierResult = await tierClassifier({
        tx: client,
        skuChannel,
        currentPosition,
        hasCompetitors: filteredOffers.length > 0,
      });

      // -----------------------------------------------------------------------
      // Optimistic-concurrency race-loser guard
      // -----------------------------------------------------------------------
      if (!tierResult.tierTransitioned && tierResult.reason === 'concurrent-transition-detected') {
        logger.warn(
          { skuChannelId, customerMarketplaceId, fromTier: tierResult.fromTier },
          'reconciliation: optimistic-concurrency race-loser — concurrent-transition-detected; skipping audit emissions (winning tx already emitted them)',
        );
        // Still bump last_checked_at for freshness.
        await client.query(
          'UPDATE sku_channels SET last_checked_at = NOW() WHERE id = $1',
          [skuChannelId],
        );
        continue;
      }

      // -----------------------------------------------------------------------
      // No-competitors / no-transition branch — no audit events
      // -----------------------------------------------------------------------
      if (!tierResult.tierTransitioned) {
        // No-transition steady-state — bump last_checked_at with tier guard.
        // AND tier = '3' is the optimistic-concurrency invariant: if master-cron
        // concurrently transitioned this row OUT of T3 between our SELECT and now,
        // rowCount === 0 and we skip — the winning tx already handled this row.
        logger.debug(
          { skuChannelId, customerMarketplaceId, reason: tierResult.reason },
          'reconciliation: T3 steady-state — no transition, bumping last_checked_at',
        );
        await client.query(
          "UPDATE sku_channels SET last_checked_at = NOW() WHERE id = $1 AND tier = '3'",
          [skuChannelId],
        );
        continue;
      }

      // -----------------------------------------------------------------------
      // Transition branch — emit BOTH audit events (Pattern A) then bump freshness
      // -----------------------------------------------------------------------
      tierTransitions++;
      if (filteredOffers.length > 0) {
        newCompetitorsDetected++;
      }

      logger.info(
        {
          skuChannelId,
          customerMarketplaceId,
          fromTier: tierResult.fromTier,
          toTier:   tierResult.toTier,
          reason:   tierResult.reason,
        },
        'reconciliation: tier transition — emitting audit events',
      );

      // Emit tier-transition Rotina — canonical PayloadForTierTransition shape.
      // Story 7.7 is the FIRST production module to emit this slug with the
      // correct { fromTier, toTier, reason } shape (cycle-assembly's emit loop
      // still uses the mis-shaped { action, newPriceCents } default per
      // deferred-work.md:472 — pre-retro data point for Epic 7 retro).
      /** @type {PayloadForTierTransition} */
      const tierTransitionPayload = {
        fromTier: tierResult.fromTier,
        toTier:   tierResult.toTier,
        reason:   tierResult.reason,
      };

      await auditWriter({
        tx:                    client,
        customerMarketplaceId,
        skuId,
        skuChannelId,
        eventType:             EVENT_TYPES.TIER_TRANSITION,
        payload:               tierTransitionPayload,
        cycleId:               passCycleId,
      });

      // Emit new-competitor-entered Notável — canonical PayloadForNewCompetitorEntered shape.
      // Story 7.7 is the FIRST production module to emit this slug with the
      // correct { skuId, competitorPriceCents, cycleId } shape.
      // cycleId = per-pass UUID (not null) — provides better audit traceability
      // than null (signals "from reconciliation pass passCycleId") per AC4 Dev Note.
      /** @type {PayloadForNewCompetitorEntered} */
      const newCompetitorPayload = {
        skuId,
        // toCents() converts P11's JSON-number total_price to integer cents at
        // the boundary (Constraint #22 — no float-price math outside shared/money/).
        competitorPriceCents: toCents(filteredOffers[0].total_price),
        cycleId:              passCycleId,
      };

      await auditWriter({
        tx:                    client,
        customerMarketplaceId,
        skuId,
        skuChannelId,
        eventType:             EVENT_TYPES.NEW_COMPETITOR_ENTERED,
        payload:               newCompetitorPayload,
        cycleId:               passCycleId,
      });

      // Bump last_checked_at — no AND tier=... guard here because the tier
      // already transitioned in this same pass (applyTierClassification issued
      // the UPDATE and it committed autocommit-style). This UPDATE is freshness-
      // bookkeeping only, not a state guard.
      await client.query(
        'UPDATE sku_channels SET last_checked_at = NOW() WHERE id = $1',
        [skuChannelId],
      );
    }
  } finally {
    client.release();
  }

  const durationMs = Date.now() - startMs;

  logger.info(
    { skusEvaluated, tierTransitions, newCompetitorsDetected, staleStateWarnings, durationMs, passCycleId },
    'reconciliation: nightly Tier-3 pass complete',
  );

  return { skusEvaluated, tierTransitions, newCompetitorsDetected, staleStateWarnings, durationMs };
}
