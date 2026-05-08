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
//   4. Emit per-customer cycle-start audit event (Bundle B: BEGIN/COMMIT on the
//      dedicated client) — matches AD19/AD20 per-customer scope
//   5. Call assembleCycle (stub until Story 5.2 ships the real implementation)
//   6. Emit per-customer cycle-end audit event (Bundle B: BEGIN/COMMIT)
//   7. Release advisory lock (try/finally guarantee)
//   8. Log cycle stats at info level (cross-customer log line, NOT an audit event)
//
// Why per-customer audit events (not global):
//   - audit_log.customer_marketplace_id is NOT NULL (AD19 schema)
//   - AD20 cycle-start description: "Ciclo iniciado para este cliente/marketplace"
//   - Bundle B atomicity (architecture _index.md): every audit event is scoped
//     to the customer_marketplace whose state it describes
//   - The cross-customer cycle-level stats are captured by the structured pino
//     log line at cycle-end (logs ≠ audit_log; observability tier, not customer-
//     facing audit trail)
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
 * Emit one cycle-scoped audit event (cycle-start or cycle-end) atomically on the
 * caller's dedicated client. Wraps writeAuditEvent in BEGIN/COMMIT so the writer's
 * `tx` parameter is an active transaction (Bundle B atomicity invariant).
 *
 * Failure is swallowed at debug level: until Story 9.1 ships the audit_log
 * partitioned table, the INSERT will fail and that's expected. After Story 9.1
 * ships, transient errors must not abort an otherwise-healthy repricing cycle.
 * The structured pino log captures any failure for observability.
 *
 * @param {import('pg').PoolClient} client - Dedicated pool client (already holds the per-customer advisory lock)
 * @param {object} params
 * @param {string} params.customerMarketplaceId - UUID of the customer this audit row belongs to
 * @param {string} params.eventType - EVENT_TYPES.CYCLE_START or EVENT_TYPES.CYCLE_END
 * @param {string} params.cycleId - UUID of the current dispatch cycle
 * @param {object} params.payload - Structured payload (PayloadForCycleStart / PayloadForCycleEnd)
 * @param {string} params.logContext - Short tag for log messages ('cycle-start' / 'cycle-end')
 * @returns {Promise<void>}
 */
async function emitCycleAuditEvent (client, { customerMarketplaceId, eventType, cycleId, payload, logContext }) {
  try {
    await client.query('BEGIN');
    await writeAuditEvent({
      tx: client,
      customerMarketplaceId,
      eventType,
      cycleId,
      payload,
    });
    await client.query('COMMIT');
  } catch (auditErr) {
    // Best-effort rollback — if the BEGIN itself failed, ROLLBACK is a no-op
    // that will also throw; we silence that secondary error to surface the
    // primary failure cleanly.
    try {
      await client.query('ROLLBACK');
    } catch {
      // Secondary rollback failure ignored — primary error is what matters
    }
    logger.debug(
      { err: auditErr, customer_marketplace_id: customerMarketplaceId, cycle_id: cycleId },
      `dispatcher: ${logContext} audit event INSERT failed (expected pre-Story 9.1; after 9.1, indicates transient DB error — cycle continues)`
    );
  }
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

      // Emit per-customer cycle-start audit event under Bundle B atomicity:
      // BEGIN/COMMIT on the dedicated client so writeAuditEvent's tx parameter
      // is an active transaction (writer's contract — see shared/audit/writer.js).
      // We catch & log on failure rather than abort the cycle: a missing audit
      // row on the start-event must not stop us from actually repricing this
      // customer. Failure is most often the absence of audit_log (Story 9.1
      // not yet applied to the local DB) or a transient connection error.
      await emitCycleAuditEvent(client, {
        customerMarketplaceId,
        eventType: EVENT_TYPES.CYCLE_START,
        cycleId,
        payload: { tierBreakdown: {} },
        logContext: 'cycle-start',
      });

      // Process this customer's SKU-channels.
      //
      // Result shape evolved in Story 5.2: the real cycle-assembly returns
      // `{ stagedCount, heldCount }` (per Story 5.2 AC#2 contract). The pre-5.2
      // stub returned `{ decisionsEmitted }`. Read both keys so the KPI / log
      // line stays accurate before AND after Story 5.2 ships.
      // Decisions = staging rows actually written (HOLD does not emit a price-
      // write decision; it emits only an audit event). Story 9.2's
      // `cycle_summaries.decisions_emitted` follows the same semantic.
      const result = await assembleCycle(client, customerMarketplaceId, skuChannels, cycleId);
      const customerDecisions = result?.decisionsEmitted ?? result?.stagedCount ?? 0;

      customersProcessed++;
      skusEvaluated += skuChannels.length;
      decisionsEmitted += customerDecisions;

      // Emit per-customer cycle-end audit event (Bundle B atomicity: BEGIN/COMMIT).
      // Same swallow-on-failure rationale as cycle-start.
      await emitCycleAuditEvent(client, {
        customerMarketplaceId,
        eventType: EVENT_TYPES.CYCLE_END,
        cycleId,
        payload: {
          skusProcessed: skuChannels.length,
          undercutCount: 0,
          ceilingRaiseCount: 0,
          holdCount: 0,
          failureCount: 0,
        },
        logContext: 'cycle-end',
      });
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

  // Log cycle-end stats at info level (AC#5).
  // This is the cross-customer observability log line — distinct from the
  // per-customer cycle-end audit_log row emitted inside the loop above.
  const cycleStats = {
    cycle_id: cycleId,
    customers_processed: customersProcessed,
    skus_evaluated: skusEvaluated,
    decisions_emitted: decisionsEmitted,
    duration_ms: durationMs,
  };
  logger.info(cycleStats, 'dispatcher: cycle-end');

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
