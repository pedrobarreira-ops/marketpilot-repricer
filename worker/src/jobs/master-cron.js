// worker/src/jobs/master-cron.js
//
// Story 5.1 / AC#1 — Master 5-minute repricing cron.
//
// Fires every 5 minutes (*/5 * * * *) and delegates to `dispatchCycle` from
// worker/src/dispatcher.js. A module-level `_dispatchInFlight` flag guards
// against overlapping ticks: if the previous cycle is still running when the
// next tick fires, the new tick is silently skipped.
//
// Concurrency guard pattern matches the scan-poller guard in worker/src/index.js
// (the _scanPolling flag) — consistent defence-in-depth approach across all
// background jobs.
//
// The `startMasterCron(logger)` factory keeps this module testable: the logger is
// injected rather than created at module scope, which prevents a logger singleton
// being constructed before tests can configure the environment.

import cron from 'node-cron';
import { dispatchCycle } from '../dispatcher.js';
import { getServiceRoleClient } from '../../../shared/db/service-role-client.js';

/** @type {boolean} In-flight guard — true while a previous tick's cycle is still running */
let _dispatchInFlight = false;

/**
 * Initialise and start the master 5-minute repricing cron.
 * The cron is registered with `node-cron` at "every 5 minutes" (Europe/Lisbon TZ).
 *
 * Concurrency guard: if `_dispatchInFlight` is true when the cron tick fires,
 * the tick is a no-op — the previous cycle is still running. This prevents
 * multiple parallel dispatch cycles which could cause duplicate repricing
 * decisions within the same customer batch.
 *
 * @param {import('pino').Logger} logger - Worker-level pino logger from index.js.
 *   Do NOT create a new logger inside this function; use the one from the caller.
 * @returns {void}
 */
export function startMasterCron (logger) {
  logger.info('master-cron: 5-minute repricing cron registered');

  cron.schedule('*/5 * * * *', () => {
    if (_dispatchInFlight) {
      logger.debug('master-cron: previous dispatch cycle still running — skipping this tick (inFlight guard)');
      return;
    }
    _dispatchInFlight = true;

    const pool = getServiceRoleClient();
    dispatchCycle({ pool }).catch((err) => {
      logger.error({ err }, 'master-cron: dispatchCycle rejected');
    }).finally(() => {
      _dispatchInFlight = false;
    });
  }, { timezone: 'Europe/Lisbon' });
}
