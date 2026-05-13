// worker/src/engine/tier-classify.js
//
// Story 7.5 — AD10 + F1 tier-classification SSoT module.
// SINGLE SOURCE OF TRUTH for per-cycle tier transitions on sku_channels rows.
//
// NOTE: This is the ENGINE-CYCLE tier classifier. Do NOT confuse with
// worker/src/lib/tier-classify.js (Story 4.4) — the ONBOARDING SCAN classifier
// that runs ONCE at SKU-channel creation. These are TWO DIFFERENT modules
// with different call sites and different roles. See worker/src/lib/tier-classify.js:9-11.
//
// Architecture: AD10 (4-state tier system), F1 (atomic T2a→T2b dual-column write),
//               SCP-2026-05-13 Path I (autocommit-per-statement semantics).
//
// Pattern C (NOT Pattern A): this module issues the UPDATE statement only.
// Audit event emission stays caller-side in cycle-assembly's existing emit loop
// (decide.js:16-17 locks the rule: decide.js does NOT import the audit writer;
// audit events are returned in auditEvents[] and emitted by the caller).
//
// ESLint constraints:
//   no-default-export: only named exports (architecture convention).
//   no-console (Constraint #18): pino only via createWorkerLogger().
//   no-raw-INSERT-audit-log (Constraint #21): Pattern C — no audit emission here.
//   no-float-price (Constraint #22): N/A — tier values are enum strings; cadence is integer minutes.
//   worker-must-filter-by-customer (Constraint #24): UPDATE filters by sku_channels.id
//     (unique per-tenant via FK chain). Mirrors anomaly-freeze.js:110-117 pattern — no pragma required.
//
// F1 atomicity guarantee: T2a→T2b transition writes BOTH tier AND tier_cadence_minutes
// in ONE UPDATE statement. Postgres applies single-statement UPDATEs atomically —
// no inter-column read tearing visible to other transactions/cron ticks. Closes the
// "dispatcher reads tier='2b' but tier_cadence_minutes still 15" race.
//
// Optimistic-concurrency guard: WHERE id=$N AND tier=$expectedFromTier mirrors
// shared/state/cron-state.js:132-137. On rowCount===0 (concurrent transition),
// returns { tierTransitioned: false, reason: 'concurrent-transition-detected' } — NO throw.
// The engine cycle is idempotent on tier: next cycle re-reads state and converges.
//
// tier_cadence_minutes value map (AD10):
//   T1:  15 min
//   T2a: 15 min
//   T2b: 45 min
//   T3:  1440 min (daily)

import { createWorkerLogger } from '../../../shared/logger.js';

const logger = createWorkerLogger();

// ---------------------------------------------------------------------------
// Cadence constants (AD10)
// ---------------------------------------------------------------------------

const CADENCE = Object.freeze({
  T1:  15,
  T2a: 15,
  T2b: 45,
  T3:  1440,
});

// ---------------------------------------------------------------------------
// applyTierClassification
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TierClassificationResult
 * @property {boolean} tierTransitioned - true if tier column was changed
 * @property {string}  fromTier         - tier value before this call
 * @property {string}  toTier           - tier value after this call (same as fromTier if no transition)
 * @property {string}  reason           - diagnostic slug for logging / caller decisions
 *   Known reason slugs: 'won-1st-place' | 't2a-elapsed-4h' | 'no-transition-stable' |
 *   'lost-1st-place' | 'lost-1st-place-from-tier3' | 'won-1st-place-from-tier3' |
 *   'competitors-disappeared' | 'concurrent-transition-detected'
 *
 * Caller uses tierTransitioned to decide whether to append EVENT_TYPES.TIER_TRANSITION
 * to engine's auditEvents array (Pattern C — audit emission stays caller-side).
 * See also: shared/audit/event-types.js:260-264 (PayloadForTierTransition typedef).
 */

/**
 * Apply the AD10 + F1 tier-transition decision for a single sku_channel row.
 *
 * Runs under Path I (autocommit-per-statement) semantics — the supplied `tx` is
 * the dispatcher's checked-out PoolClient in autocommit mode, NOT an active
 * BEGIN/COMMIT transaction. Each await tx.query() autocommits at its own boundary.
 *
 * Pattern C: this function issues the UPDATE only. Audit event emission happens
 * in the caller's existing emit loop (cycle-assembly.js:199-211).
 *
 * @param {object}  params
 * @param {object}  params.tx              - PoolClient (autocommit per SCP-2026-05-13 Path I). Must have .query().
 * @param {object}  params.skuChannel      - Full sku_channels row including id, tier, tier_cadence_minutes, last_won_at.
 * @param {number|null} params.currentPosition - 1 = in 1st place, >1 = contested; null when hasCompetitors=false.
 * @param {boolean} params.hasCompetitors  - true when filteredOffers.length > 0.
 * @returns {Promise<TierClassificationResult>}
 */
export async function applyTierClassification ({ tx, skuChannel, currentPosition, hasCompetitors }) {
  const fromTier = skuChannel.tier;
  const skuChannelId = skuChannel.id;

  // ---------------------------------------------------------------------------
  // Branch: no competitors → {T1,T2a,T2b} → T3 | T3 stays T3
  // ---------------------------------------------------------------------------

  if (hasCompetitors === false) {
    if (fromTier === '3') {
      // T3 stays T3 — steady-state (no competitors, already in T3)
      logger.debug(
        { skuChannelId, fromTier, toTier: '3' },
        'tier-classify: T3 steady-state (no competitors)',
      );
      return { tierTransitioned: false, fromTier: '3', toTier: '3', reason: 'no-transition-stable' };
    }

    // {T1, T2a, T2b} → T3 (competitors disappeared)
    // last_won_at NOT updated — preserved as analytics signal per AC1 table
    const result = await tx.query(
      `UPDATE sku_channels
          SET tier = $1, tier_cadence_minutes = $2, updated_at = NOW()
        WHERE id = $3 AND tier = $4`,
      ['3', CADENCE.T3, skuChannelId, fromTier],
    );

    if (result.rowCount === 0) {
      logger.warn(
        { skuChannelId, fromTier, toTier: '3' },
        'tier-classify: concurrent-transition-detected (competitors-disappeared → T3, rowCount=0)',
      );
      return { tierTransitioned: false, fromTier, toTier: fromTier, reason: 'concurrent-transition-detected' };
    }

    logger.info(
      { skuChannelId, fromTier, toTier: '3', reason: 'competitors-disappeared' },
      'tier-classify: tier transition → T3 (competitors disappeared)',
    );
    return { tierTransitioned: true, fromTier, toTier: '3', reason: 'competitors-disappeared' };
  }

  // ---------------------------------------------------------------------------
  // Branch: has competitors
  // ---------------------------------------------------------------------------

  // T3 → T2a (won 1st place with new competitor)
  if (fromTier === '3' && currentPosition === 1) {
    const result = await tx.query(
      `UPDATE sku_channels
          SET tier = $1, tier_cadence_minutes = $2, last_won_at = NOW(), updated_at = NOW()
        WHERE id = $3 AND tier = $4`,
      ['2a', CADENCE.T2a, skuChannelId, '3'],
    );

    if (result.rowCount === 0) {
      logger.warn(
        { skuChannelId, fromTier: '3', toTier: '2a' },
        'tier-classify: concurrent-transition-detected (T3→T2a, rowCount=0)',
      );
      return { tierTransitioned: false, fromTier: '3', toTier: '3', reason: 'concurrent-transition-detected' };
    }

    logger.info(
      { skuChannelId, fromTier: '3', toTier: '2a', reason: 'won-1st-place-from-tier3' },
      'tier-classify: tier transition T3 → T2a (new competitor, winning)',
    );
    return { tierTransitioned: true, fromTier: '3', toTier: '2a', reason: 'won-1st-place-from-tier3' };
  }

  // T3 → T1 (new competitor + losing 1st place)
  // last_won_at stays null (no win has occurred) — preserved per AC1 table
  if (fromTier === '3' && currentPosition > 1) {
    const result = await tx.query(
      `UPDATE sku_channels
          SET tier = $1, tier_cadence_minutes = $2, updated_at = NOW()
        WHERE id = $3 AND tier = $4`,
      ['1', CADENCE.T1, skuChannelId, '3'],
    );

    if (result.rowCount === 0) {
      logger.warn(
        { skuChannelId, fromTier: '3', toTier: '1' },
        'tier-classify: concurrent-transition-detected (T3→T1, rowCount=0)',
      );
      return { tierTransitioned: false, fromTier: '3', toTier: '3', reason: 'concurrent-transition-detected' };
    }

    logger.info(
      { skuChannelId, fromTier: '3', toTier: '1', reason: 'lost-1st-place-from-tier3' },
      'tier-classify: tier transition T3 → T1 (new competitor, losing)',
    );
    return { tierTransitioned: true, fromTier: '3', toTier: '1', reason: 'lost-1st-place-from-tier3' };
  }

  // {T2, T2a, T2b} → T1 (lost 1st place — currentPosition > 1)
  // last_won_at NOT updated — preserved as analytics signal per AC1 table
  if ((fromTier === '2' || fromTier === '2a' || fromTier === '2b') && currentPosition > 1) {
    const result = await tx.query(
      `UPDATE sku_channels
          SET tier = $1, tier_cadence_minutes = $2, updated_at = NOW()
        WHERE id = $3 AND tier = $4`,
      ['1', CADENCE.T1, skuChannelId, fromTier],
    );

    if (result.rowCount === 0) {
      logger.warn(
        { skuChannelId, fromTier, toTier: '1' },
        'tier-classify: concurrent-transition-detected ({T2,T2a,T2b}→T1, rowCount=0)',
      );
      return { tierTransitioned: false, fromTier, toTier: fromTier, reason: 'concurrent-transition-detected' };
    }

    logger.info(
      { skuChannelId, fromTier, toTier: '1', reason: 'lost-1st-place' },
      'tier-classify: tier transition {T2x} → T1 (lost 1st place)',
    );
    return { tierTransitioned: true, fromTier, toTier: '1', reason: 'lost-1st-place' };
  }

  // T1 → T2a (won 1st place — has competitors, position=1)
  if (fromTier === '1' && currentPosition === 1) {
    const result = await tx.query(
      `UPDATE sku_channels
          SET tier = $1, tier_cadence_minutes = $2, last_won_at = NOW(), updated_at = NOW()
        WHERE id = $3 AND tier = $4`,
      ['2a', CADENCE.T2a, skuChannelId, '1'],
    );

    if (result.rowCount === 0) {
      logger.warn(
        { skuChannelId, fromTier: '1', toTier: '2a' },
        'tier-classify: concurrent-transition-detected (T1→T2a, rowCount=0)',
      );
      return { tierTransitioned: false, fromTier: '1', toTier: '1', reason: 'concurrent-transition-detected' };
    }

    logger.info(
      { skuChannelId, fromTier: '1', toTier: '2a', reason: 'won-1st-place' },
      'tier-classify: tier transition T1 → T2a (won 1st place)',
    );
    return { tierTransitioned: true, fromTier: '1', toTier: '2a', reason: 'won-1st-place' };
  }

  // T2a — position=1 (still winning): check the 4-hour window
  if (fromTier === '2a' && currentPosition === 1) {
    const lastWonAt = skuChannel.last_won_at;
    const fourHoursAgoMs = Date.now() - 4 * 60 * 60 * 1000;
    const lastWonAtMs = lastWonAt instanceof Date
      ? lastWonAt.getTime()
      : new Date(lastWonAt).getTime();

    if (lastWonAtMs >= fourHoursAgoMs) {
      // T2a stays T2a — within 4h window, no UPDATE
      logger.debug(
        { skuChannelId, fromTier: '2a', toTier: '2a', reason: 'no-transition-stable' },
        'tier-classify: T2a steady-state (within 4h window)',
      );
      return { tierTransitioned: false, fromTier: '2a', toTier: '2a', reason: 'no-transition-stable' };
    }

    // T2a → T2b: F1 atomic dual-column write (both tier AND tier_cadence_minutes in ONE UPDATE)
    // This single-statement UPDATE closes the dispatcher race where it could read
    // tier='2b' but tier_cadence_minutes=15 between two separate writes.
    const result = await tx.query(
      `UPDATE sku_channels
          SET tier = $1, tier_cadence_minutes = $2, updated_at = NOW()
        WHERE id = $3 AND tier = $4`,
      ['2b', CADENCE.T2b, skuChannelId, '2a'],
    );

    if (result.rowCount === 0) {
      logger.warn(
        { skuChannelId, fromTier: '2a', toTier: '2b' },
        'tier-classify: concurrent-transition-detected (T2a→T2b, rowCount=0)',
      );
      return { tierTransitioned: false, fromTier: '2a', toTier: '2a', reason: 'concurrent-transition-detected' };
    }

    logger.info(
      { skuChannelId, fromTier: '2a', toTier: '2b', reason: 't2a-elapsed-4h' },
      'tier-classify: tier transition T2a → T2b (F1 atomic dual-column write — 4h elapsed)',
    );
    return { tierTransitioned: true, fromTier: '2a', toTier: '2b', reason: 't2a-elapsed-4h' };
  }

  // T2b stays T2b — still winning at promoted cadence, no UPDATE needed
  if (fromTier === '2b' && currentPosition === 1) {
    logger.debug(
      { skuChannelId, fromTier: '2b', toTier: '2b', reason: 'no-transition-stable' },
      'tier-classify: T2b steady-state (still winning at promoted cadence)',
    );
    return { tierTransitioned: false, fromTier: '2b', toTier: '2b', reason: 'no-transition-stable' };
  }

  // T1 stays T1 — still losing (currentPosition > 1), no UPDATE needed
  // (T1 with competitors + position > 1 is the initial losing state — wait for a win)
  if (fromTier === '1' && currentPosition > 1) {
    logger.debug(
      { skuChannelId, fromTier: '1', toTier: '1', reason: 'no-transition-stable' },
      'tier-classify: T1 steady-state (still losing — no transition needed)',
    );
    return { tierTransitioned: false, fromTier: '1', toTier: '1', reason: 'no-transition-stable' };
  }

  // Fallthrough: unexpected state combination — log and return no-op
  logger.warn(
    { skuChannelId, fromTier, currentPosition, hasCompetitors },
    'tier-classify: unhandled state combination — returning no-transition-stable',
  );
  return { tierTransitioned: false, fromTier, toTier: fromTier, reason: 'no-transition-stable' };
}
