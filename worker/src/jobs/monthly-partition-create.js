// safe: cross-customer cron — creates audit_log partitions for the shared table,
// not per-customer rows. Not subject to worker-must-filter-by-customer rule.
// Story 9.1 SSoT: this is the sole cron responsible for audit_log partition management.

import { getServiceRoleClient } from '../../../shared/db/service-role-client.js';

/**
 * Creates the audit_log partition for 2 months from now (IF NOT EXISTS).
 * Runs on the 28th of each month at 02:00 Lisbon (Europe/Lisbon TZ).
 *
 * Why 2 months ahead: on May 28th, June's partition already exists (created by the
 * initial migration or a prior cron run); the buffer creates July's partition so it
 * exists well before July 1st. The initial migration seeds 12 partitions
 * (2026-05 through 2027-04); the cron takes over for month 13 onward.
 *
 * Idempotent: IF NOT EXISTS means re-running produces no errors and no duplicates.
 *
 * @param {import('pino').Logger} logger - Worker-level pino logger from index.js.
 *   Do NOT create a new logger inside this function; use the one from the caller.
 */
export async function runMonthlyPartitionCreate (logger) {
  // Compute the target partition: 2 calendar months from today.
  // Example: fires on 2026-05-28 → target = 2026-07 (July).
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');

  // Compute the partition's exclusive upper bound (first day of the month AFTER target).
  const nextMonthDate = new Date(target.getFullYear(), target.getMonth() + 1, 1);
  const nextYear = nextMonthDate.getFullYear();
  const nextMonth = String(nextMonthDate.getMonth() + 1).padStart(2, '0');

  const partitionName = `audit_log_${year}_${month}`;
  const fromVal = `${year}-${month}-01`;
  const toVal = `${nextYear}-${nextMonth}-01`;

  const db = getServiceRoleClient();
  try {
    await db.query(
      `CREATE TABLE IF NOT EXISTS ${partitionName} PARTITION OF audit_log
       FOR VALUES FROM ('${fromVal}') TO ('${toVal}')`
    );
    logger.info(
      { partition: partitionName, from: fromVal, to: toVal },
      'monthly-partition-create: partition ready'
    );
  } catch (err) {
    logger.error(
      { partition: partitionName, err: err.message },
      'monthly-partition-create: failed to create partition'
    );
  }
}
