// worker/src/dispatcher.js
//
// SSoT module: Master dispatch cycle for the repricing worker.
// Story 5.1 / AC#1, AC#2, AC#3, AC#5 — AD17 dispatcher implementation.
//
// One call to `dispatchCycle` represents one full 5-minute repricing tick:
//   1. SELECT all eligible SKU-channels across ACTIVE customers (AD17 SQL verbatim)
//   2. Group rows by customer_marketplace_id
//   3. Attempt advisory lock per customer (skip if locked — another worker instance
//      is handling that customer this tick)
//   4. Call assembleCycle (stub until Story 5.2 ships the real implementation)
//   5. Release advisory lock (try/finally guarantee)
//   6. Emit cycle-start and cycle-end audit events; log stats at info level
//
// Negative assertions (AD17, architectural constraint):
//   - No lock tracking table — Postgres session-scoped advisory locks only
//   - No row-based pseudo-mutex (no SELECT ... FOR UPDATE SKIP LOCKED on a locks table)
//   - No Redis / BullMQ / external queue
//
// The dispatcher's initial SELECT is cross-customer by design (it fetches ALL
// ACTIVE customers to distribute work). The pragma comment below suppresses the
// `worker-must-filter-by-customer` ESLint rule for that specific query.

import { randomUUID } from 'node:crypto';
import { getServiceRoleClient } from '../../shared/db/service-role-client.js';
import { createWorkerLogger } from '../../shared/logger.js';
import { tryAcquireCustomerLock, releaseCustomerLock } from './advisory-lock.js';
import { writeAuditEvent } from '../../shared/audit/writer.js';
import { EVENT_TYPES } from '../../shared/audit/event-types.js';

const logger = createWorkerLogger();

// ---------------------------------------------------------------------------
// AD17 Dispatcher SELECT SQL — verbatim; do NOT alter without updating AD17.
// Fetches all eligible SKU-channels across all ACTIVE customer_marketplaces,
// ordered for fair round-robin (customer first, then oldest last_checked_at).
// LIMIT is parameterised as $1 (DISPATCH_BATCH_SIZE env var, default 1000).
//
// Hot-path index hit: idx_sku_channels_dispatch (Story 4.2) covers this query.
// ---------------------------------------------------------------------------
const DISPATCH_SQL = `
SELECT cm.id, sc.id AS sku_channel_id, sc.sku_id, sc.channel_code
  FROM customer_marketplaces cm
  JOIN sku_channels sc ON sc.customer_marketplace_id = cm.id
 WHERE cm.cron_state = 'ACTIVE'
   AND sc.frozen_for_anomaly_review = false
   AND sc.pending_import_id IS NULL
   AND sc.excluded_at IS NULL
   AND sc.last_checked_at + (sc.tier_cadence_minutes * INTERVAL '1 minute') < NOW()
 ORDER BY cm.id, sc.last_checked_at ASC
 LIMIT $1
`;

/**
 * Read DISPATCH_BATCH_SIZE from the environment with a safe default of 1000.
 * The value is validated to be a positive integer; falls back to 1000 on
 * invalid input (non-numeric or ≤ 0).
 *
 * @returns {number} Batch size (positive integer)
 */
function getBatchSize () {
  const raw = process.env.DISPATCH_BATCH_SIZE;
  if (raw == null) return 1000;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return 1000;
  return parsed;
}

/**
 * Group an array of flat rows (each with a `.id` customer_marketplace UUID) into
 * a Map keyed by customer_marketplace_id, with each value being the array of
 * rows for that customer.
 *
 * @param {Array<{id: string, sku_channel_id: string, sku_id: string, channel_code: string}>} rows
 * @returns {Map<string, Array>}
 */
function groupByCustomer (rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

/**
 * Stub for assembleCycle — replaced by the real implementation when Story 5.2 ships.
 * Dynamically imported so that the real module is used automatically once it exists.
 *
 * @param {object} _client - Pool client (ignored in stub)
 * @param {string} _customerMarketplaceId - Customer UUID (ignored in stub)
 * @param {Array} _skuChannels - SKU-channel rows (ignored in stub)
 * @param {string} _cycleId - Cycle UUID (ignored in stub)
 * @returns {Promise<{decisionsEmitted: number}>}
 */
async function defaultAssembleCycleStub (_client, _customerMarketplaceId, _skuChannels, _cycleId) {
  logger.debug('assembleCycle stub — Story 5.2 not yet shipped');
  return { decisionsEmitted: 0 };
}

/**
 * Run one full dispatch cycle: select work, acquire advisory locks per customer,
 * call assembleCycle (stub until Story 5.2), emit audit events, log stats.
 *
 * The `pool` option is injectable for unit tests; defaults to the service-role
 * pool singleton (`getServiceRoleClient()`).
 *
 * @param {{ pool?: import('pg').Pool }} [options] - Injects a mock pool in tests; defaults to getServiceRolePool()
 * @returns {Promise<{ customersProcessed: number, skusEvaluated: number, durationMs: number }>}
 */
export async function dispatchCycle (options = {}) {
  const pool = options.pool ?? getServiceRoleClient();
  const cycleId = randomUUID();
  const startedAt = Date.now();

  logger.info({ cycle_id: cycleId }, 'dispatcher: cycle-start');

  // Emit cycle-start audit event.
  // cycle-start / cycle-end are cross-customer global events — pass null for
  // customerMarketplaceId. The audit writer's null guard is handled by try/catch;
  // the cross-customer global pattern will be supported in a future writer update.
  try {
    // safe: cross-customer cron
    await writeAuditEvent({
      tx: pool,
      customerMarketplaceId: null,
      eventType: EVENT_TYPES.CYCLE_START,
      cycleId,
      payload: { tierBreakdown: {} },
    });
  } catch (auditErr) {
    logger.debug({ err: auditErr }, 'dispatcher: cycle-start audit event skipped (cross-customer global — writer requires customerMarketplaceId; will be supported after writer update)');
  }

  // Resolve assembleCycle: try real module, fall back to stub
  let assembleCycle = defaultAssembleCycleStub;
  try {
    const cycleAssemblyModule = await import('./cycle-assembly.js');
    assembleCycle = cycleAssemblyModule.assembleCycle;
  } catch {
    // Story 5.2 not yet shipped — use stub
  }

  // AD17: cross-customer batch SELECT (deliberately cross-customer — fetches all ACTIVE)
  const batchSize = getBatchSize();
  // safe: cross-customer cron
  const { rows } = await pool.query(DISPATCH_SQL, [batchSize]);

  // Group rows by customer_marketplace_id for per-customer advisory lock handling
  const customerGroups = groupByCustomer(rows);

  let customersProcessed = 0;
  let skusEvaluated = 0;
  let decisionsEmitted = 0;

  // Per-customer dispatch loop with advisory lock guard
  for (const [customerMarketplaceId, skuChannels] of customerGroups) {
    // Acquire a dedicated pool client for this customer's advisory lock.
    // Advisory locks are SESSION-scoped — must use a dedicated client, not pool.query.
    let client;
    try {
      client = await pool.connect();
    } catch (connectErr) {
      logger.warn({ err: connectErr, customer_marketplace_id: customerMarketplaceId }, 'dispatcher: failed to acquire pool client for customer — skipping');
      continue;
    }

    let lockAcquired = false;
    try {
      lockAcquired = await tryAcquireCustomerLock(client, customerMarketplaceId);
      if (!lockAcquired) {
        logger.debug({ customer_marketplace_id: customerMarketplaceId }, 'dispatcher: advisory lock held by another instance — skipping this customer this tick');
        continue;
      }

      // Process this customer's SKU-channels
      const result = await assembleCycle(client, customerMarketplaceId, skuChannels, cycleId);
      const customerDecisions = result?.decisionsEmitted ?? 0;

      customersProcessed++;
      skusEvaluated += skuChannels.length;
      decisionsEmitted += customerDecisions;

      await releaseCustomerLock(client, customerMarketplaceId);
      lockAcquired = false;
    } catch (err) {
      logger.error({ err, customer_marketplace_id: customerMarketplaceId }, 'dispatcher: error processing customer batch');
    } finally {
      // Ensure advisory lock is released on error (belt-and-suspenders;
      // Postgres auto-releases on session-close but explicit release is best practice)
      if (lockAcquired) {
        try {
          await releaseCustomerLock(client, customerMarketplaceId);
        } catch (releaseErr) {
          logger.warn({ err: releaseErr, customer_marketplace_id: customerMarketplaceId }, 'dispatcher: advisory lock release failed (session close will auto-release)');
        }
      }
      client.release();
    }
  }

  const durationMs = Date.now() - startedAt;

  // Log cycle-end stats at info level (AC#5)
  const cycleStats = {
    cycle_id: cycleId,
    customers_processed: customersProcessed,
    skus_evaluated: skusEvaluated,
    decisions_emitted: decisionsEmitted,
    duration_ms: durationMs,
  };
  logger.info(cycleStats, 'dispatcher: cycle-end');

  // Emit cycle-end audit event (same cross-customer global pattern as cycle-start)
  try {
    // safe: cross-customer cron
    await writeAuditEvent({
      tx: pool,
      customerMarketplaceId: null,
      eventType: EVENT_TYPES.CYCLE_END,
      cycleId,
      payload: {
        skusProcessed: skusEvaluated,
        undercutCount: 0,
        ceilingRaiseCount: 0,
        holdCount: 0,
        failureCount: 0,
      },
    });
  } catch (auditErr) {
    logger.debug({ err: auditErr }, 'dispatcher: cycle-end audit event skipped (cross-customer global — writer requires customerMarketplaceId; will be supported after writer update)');
  }

  // Write to cycle_summaries stub (Story 9.2 ships the table schema).
  // Wrapped in try/catch — INSERT will fail until Story 9.2 runs.
  // cycle_summaries is a cycle-level aggregate table, not per-customer-scoped.
  try {
    // safe: cross-customer cron
    await pool.query(
      `INSERT INTO cycle_summaries (cycle_id, customers_processed, skus_evaluated, decisions_emitted, duration_ms, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [cycleId, customersProcessed, skusEvaluated, decisionsEmitted, durationMs]
    );
  } catch (err) {
    logger.debug({ err }, 'cycle_summaries INSERT skipped — table not yet created (Story 9.2)');
  }

  return { customersProcessed, skusEvaluated, durationMs };
}
