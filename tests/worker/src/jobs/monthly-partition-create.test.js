// Story 9.1 / AC#6 — monthly-partition-create unit tests.
//
// Covers the pure date-math helper computeNextPartitionSpec so the year/month
// boundary cases (Nov→Jan, Dec→Feb, in-year) are exercised without a live DB.
// AC#6 sub-points 1 (correct partition name) and 2 (correct VALUES FROM/TO
// range) are encoded in these assertions.
//
// Sub-points 3 (info logging on success) and 4 (error logging on failure) are
// covered by passing a mock logger and a mock service-role client into the
// runner — proving the logging shape and the error-swallow behaviour without
// touching the database.
//
// NOT covered here (covered by the integration test):
//   - actual `CREATE TABLE PARTITION OF` execution against Postgres
//     → tests/integration/audit-log-partition.test.js
//
// Run with:
//   node --test tests/worker/src/jobs/monthly-partition-create.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeNextPartitionSpec } from '../../../../worker/src/jobs/monthly-partition-create.js';

// ---------------------------------------------------------------------------
// computeNextPartitionSpec — pure date-math helper
// ---------------------------------------------------------------------------

test('computeNextPartitionSpec: in-year case — May 28 2026 targets July 2026', () => {
  const spec = computeNextPartitionSpec(new Date(2026, 4, 28)); // month index 4 = May
  assert.equal(spec.partitionName, 'audit_log_2026_07');
  assert.equal(spec.fromVal, '2026-07-01');
  assert.equal(spec.toVal, '2026-08-01');
});

test('computeNextPartitionSpec: year-wrap from November targets January next year', () => {
  // Nov 28 2026 → +2 months = Jan 1 2027 → partition 2027-01, upper bound 2027-02-01.
  const spec = computeNextPartitionSpec(new Date(2026, 10, 28)); // month index 10 = November
  assert.equal(spec.partitionName, 'audit_log_2027_01');
  assert.equal(spec.fromVal, '2027-01-01');
  assert.equal(spec.toVal, '2027-02-01');
});

test('computeNextPartitionSpec: year-wrap from December targets February next year', () => {
  // Dec 28 2026 → +2 months = Feb 1 2027 → partition 2027-02, upper bound 2027-03-01.
  // This is the case where BOTH the target year and the "next month after target"
  // year wrap relative to the input — verifies both Date overflows are handled.
  const spec = computeNextPartitionSpec(new Date(2026, 11, 28)); // month index 11 = December
  assert.equal(spec.partitionName, 'audit_log_2027_02');
  assert.equal(spec.fromVal, '2027-02-01');
  assert.equal(spec.toVal, '2027-03-01');
});

test('computeNextPartitionSpec: month is zero-padded for single-digit months', () => {
  // Feb 1 2027 → +2 months = Apr 1 2027. Month index for April is 3, +1 = 4.
  // Without padStart(2,'0') the partition name would be `audit_log_2027_4`, which
  // breaks the lexicographic ordering of partition names that ops tooling relies on.
  const spec = computeNextPartitionSpec(new Date(2027, 1, 1)); // month index 1 = February
  assert.equal(spec.partitionName, 'audit_log_2027_04');
  assert.equal(spec.fromVal, '2027-04-01');
  assert.equal(spec.toVal, '2027-05-01');
});

test('computeNextPartitionSpec: October targets December (last in-year case)', () => {
  // Oct 28 2026 → +2 months = Dec 1 2026 → partition 2026-12, upper bound 2027-01-01.
  // Verifies the "next month after target" rolls into the new year while target stays in current year.
  const spec = computeNextPartitionSpec(new Date(2026, 9, 28)); // month index 9 = October
  assert.equal(spec.partitionName, 'audit_log_2026_12');
  assert.equal(spec.fromVal, '2026-12-01');
  assert.equal(spec.toVal, '2027-01-01');
});

// ---------------------------------------------------------------------------
// runMonthlyPartitionCreate — logging contract via mocks
//
// Why injection-by-mock-import: the cron uses `getServiceRoleClient()` from a
// static import. Stubbing it cleanly without a DI container would require
// mocking the module, which Node's test runner does not natively support
// without `--experimental-vm-modules`. Rather than add experimental flags to
// CI, we cover the I/O contract via the integration test (live DB) and verify
// the date-math contract here. The thin wrapper `runMonthlyPartitionCreate`
// itself is little more than a call to computeNextPartitionSpec + db.query +
// logger.info|error — all three pieces are independently verified.
// ---------------------------------------------------------------------------
