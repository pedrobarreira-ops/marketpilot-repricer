// tests/worker/jobs/reconciliation.test.js
//
// J2 (Epic 7 retro 2026-05-14) — Cron-entry coverage for
// worker/src/jobs/reconciliation.js. Pins the three load-bearing invariants
// that production reliability depends on:
//   1. Cron schedule string  → '0 0 * * *' (midnight daily, exactly that mask)
//   2. Timezone option        → 'Europe/Lisbon' (per AC2)
//   3. Defensive .catch()     → callback wraps runReconciliationPass() so a
//                               rejected promise becomes a logged error, NOT
//                               an unhandledRejection that destabilises the
//                               worker process
//
// Per deferred-work.md:500 — node-cron does not await the cron callback; the
// .catch() is the ONLY guard between a transient pool/query failure and the
// worker crashing. This test is purely structural (source-inspection + module-
// load) — behavioural exercise of cron-fire timing is not feasible without
// running an actual node-cron scheduler in the test process.
//
// Run with: node --test tests/worker/jobs/reconciliation.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(__dirname, '../../../worker/src/jobs/reconciliation.js');

describe('worker/src/jobs/reconciliation.js — source inspection (J2 cron-entry contract)', () => {
  test('exports startReconciliationCron and the import loads without throwing', async () => {
    const mod = await import('../../../worker/src/jobs/reconciliation.js');
    assert.equal(typeof mod.startReconciliationCron, 'function', 'startReconciliationCron must be exported as a function');
  });

  test('cron schedule string is exactly "0 0 * * *" (midnight daily)', () => {
    const src = readFileSync(SOURCE_PATH, 'utf-8');
    // Match cron.schedule('0 0 * * *', ...) — allow single or double quotes.
    const scheduleMatch = /cron\.schedule\s*\(\s*['"]0\s+0\s+\*\s+\*\s+\*['"]/.test(src);
    assert.ok(
      scheduleMatch,
      'startReconciliationCron MUST call cron.schedule with the literal string "0 0 * * *" — daily midnight cadence is the AC2 contract',
    );
  });

  test('cron schedule is registered with Europe/Lisbon timezone', () => {
    const src = readFileSync(SOURCE_PATH, 'utf-8');
    // node-cron options object: { timezone: 'Europe/Lisbon' } (allow whitespace + quote variants).
    const tzMatch = /timezone\s*:\s*['"]Europe\/Lisbon['"]/.test(src);
    assert.ok(
      tzMatch,
      'cron.schedule MUST receive { timezone: "Europe/Lisbon" } — AC2 requires Lisbon-local midnight (not server-local), so DST shifts do not drift the daily pass',
    );
  });

  test('cron callback wraps runReconciliationPass with defensive .catch()', () => {
    const src = readFileSync(SOURCE_PATH, 'utf-8');
    // The callback must:
    //   1. Call runReconciliationPass(...)
    //   2. Chain .catch(...) on the returned promise so rejections become logs
    //      not unhandledRejection events.
    // Regex tolerates whitespace + nested parens (e.g. getServiceRoleClient())
    // by matching from the call site to ).catch( without requiring balanced
    // parens inside.
    const guardedCallPattern = /runReconciliationPass\s*\(.*?\)\s*\.catch\s*\(/s;
    assert.ok(
      guardedCallPattern.test(src),
      'startReconciliationCron MUST chain `.catch(...)` directly onto the runReconciliationPass(...) call inside the cron callback. Without this guard, a rejected promise propagates as unhandledRejection and the worker process may crash. See deferred-work.md:500.',
    );
  });

  test('cron callback .catch() handler invokes logger.error (not logger.warn / logger.info)', () => {
    const src = readFileSync(SOURCE_PATH, 'utf-8');
    // The .catch handler must call logger.error so the failure surfaces in
    // error-level monitoring (alerting + retention). warn/info would silently
    // bury cron-pass failures.
    const errorHandlerPattern = /\.catch\s*\(\s*\(?[^)]*\)?\s*=>\s*\{[\s\S]*?logger\.error\s*\(/;
    assert.ok(
      errorHandlerPattern.test(src),
      'The cron callback .catch() handler MUST call logger.error(...) — failure of the daily reconciliation pass is error-level, not warn/info',
    );
  });
});
