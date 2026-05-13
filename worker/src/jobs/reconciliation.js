// worker/src/jobs/reconciliation.js
//
// Story 7.7 / AC2 — Daily Tier-3 nightly-reconciliation cron entry.
//
// Cron schedule: 0 0 * * * (midnight Lisbon time — daily).
// Fires `runReconciliationPass` once per day to sweep every Tier 3
// sku_channel across ALL customers, fetch P11 + self-filter, apply
// tier-classification on real transitions, and emit tier-transition +
// new-competitor-entered audit events directly (Pattern A — bypasses
// cycle-assembly's emit loop and supplies canonical payload shapes per
// shared/audit/event-types.js PayloadForTierTransition +
// PayloadForNewCompetitorEntered).
//
// Why NO advisory lock per customer (rationale for lack of pg_try_advisory_lock):
//   Story 7.5's optimistic-concurrency guard in tier-classify.js (WHERE id=$N
//   AND tier=$expectedFromTier) handles the master-cron-vs-reconciliation race
//   directly. If master-cron's 5-min tick happens to pick up a T3 row in the
//   same millisecond reconciliation is processing it, only one transition wins;
//   the other returns 'concurrent-transition-detected'. Adding advisory locks
//   per customer would prevent this race but would also serialise reconciliation
//   behind any in-flight master-cron cycle holding the customer's advisory lock
//   — defeats the daily-pass guarantee for all T3 rows of that customer.
//
// Why NO in-flight guard (unlike master-cron.js's _dispatchInFlight):
//   Reconciliation runs ONCE per day; the master-cron tick that fires at
//   midnight Lisbon is a separate process. Overlap is bounded by the optimistic-
//   concurrency guard. If empirical issues surface during dogfood, Phase 2 can
//   add a _reconciliationInFlight flag mirroring master-cron.js's pattern.
//
// Defensive .catch(): node-cron does not await the cron callback. If
// runReconciliationPass rejects (e.g., pool.connect() throws, query fails
// outside the inner try), the rejection would propagate as unhandledRejection
// and could destabilise the worker process. Catching here turns any escaping
// rejection into a structured log entry so the worker stays up and the next
// day's cron tick still runs. Mirror: worker/src/index.js:78-86 pattern for
// monthly-partition-create.js.
//
// Factory pattern: startReconciliationCron(logger) mirrors startMasterCron
// (worker/src/jobs/master-cron.js:38) and runMonthlyPartitionCreate
// (worker/src/jobs/monthly-partition-create.js:60) — logger injected, not
// created at module scope. Returns void.

import cron from 'node-cron';
import { runReconciliationPass } from '../safety/reconciliation.js';
import { getServiceRoleClient } from '../../../shared/db/service-role-client.js';

/**
 * Initialise and start the daily Tier-3 nightly-reconciliation cron.
 *
 * Registered at midnight Lisbon time (Europe/Lisbon TZ). Fires once per day.
 * No in-flight guard — daily cadence makes overlap extremely unlikely; the
 * optimistic-concurrency guard in applyTierClassification handles the rare
 * master-cron-vs-reconciliation race window. See top-of-file comment for
 * rationale.
 *
 * @param {import('pino').Logger} logger - Worker-level pino logger from index.js.
 *   Do NOT create a new logger inside this function; use the one from the caller.
 * @returns {void}
 */
export function startReconciliationCron (logger) {
  logger.info('reconciliation: daily Tier-3 nightly-pass cron registered (midnight Lisbon)');

  cron.schedule('0 0 * * *', () => {
    runReconciliationPass({ pool: getServiceRoleClient(), logger }).catch((err) => {
      logger.error({ err }, 'reconciliation: cron callback rejected');
    });
  }, { timezone: 'Europe/Lisbon' });
}
