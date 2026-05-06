// safe: cross-customer cron — creates audit_log partitions for the shared table,
// not per-customer rows. Not subject to worker-must-filter-by-customer rule.
// Story 9.1 SSoT: this is the sole cron responsible for audit_log partition management.

import { getServiceRoleClient } from '../../../shared/db/service-role-client.js';

/**
 * Compute the partition spec (name + range bounds) for a given "now" reference
 * date, targeting 2 calendar months ahead. Pure function — no I/O — so the
 * non-trivial date math (year/month boundaries, leap-year-irrelevant since we
 * always anchor to day 1) can be unit-tested without a live database.
 *
 * Why a separate helper: the cron's date math has three boundary cases that
 * each need verification (year wrap from Nov→Jan, year wrap from Dec→Feb, the
 * common in-year case). Inlining the math in runMonthlyPartitionCreate left
 * those cases untested. Exporting the pure helper lets unit tests cover all
 * three boundaries while the cron itself remains a thin DB call wrapper.
 *
 * @param {Date} now - The reference date (typically `new Date()` at cron tick time).
 * @returns {{ partitionName: string, fromVal: string, toVal: string, year: number, month: string }}
 *   `fromVal` is the inclusive lower bound (YYYY-MM-01); `toVal` is the
 *   exclusive upper bound (first day of month AFTER target).
 */
export function computeNextPartitionSpec (now) {
  // Target: 2 calendar months from now. JS Date constructor handles month
  // overflow (month 13 → next year, month 1) so this works across year wraps.
  const target = new Date(now.getFullYear(), now.getMonth() + 2, 1);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, '0');

  // Exclusive upper bound: first day of the month AFTER target. Same overflow
  // handling — Dec → Jan of next year.
  const nextMonthDate = new Date(target.getFullYear(), target.getMonth() + 1, 1);
  const nextYear = nextMonthDate.getFullYear();
  const nextMonth = String(nextMonthDate.getMonth() + 1).padStart(2, '0');

  return {
    partitionName: `audit_log_${year}_${month}`,
    fromVal: `${year}-${month}-01`,
    toVal: `${nextYear}-${nextMonth}-01`,
    year,
    month,
  };
}

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
  const { partitionName, fromVal, toVal } = computeNextPartitionSpec(new Date());

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
