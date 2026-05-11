import cron from 'node-cron';
import { getEnv } from '../../shared/config/runtime-env.js';
import { loadMasterKey } from '../../shared/crypto/master-key-loader.js';
import { createWorkerLogger } from '../../shared/logger.js';
import { startHeartbeat } from './jobs/heartbeat.js';
import { startMasterCron } from './jobs/master-cron.js';
import { startPri02PollCron } from './jobs/pri02-poll.js';
import { runMonthlyPartitionCreate } from './jobs/monthly-partition-create.js';
import { processNextPendingScan } from './jobs/onboarding-scan.js';
import { closeServiceRolePool } from '../../shared/db/service-role-client.js';

getEnv();

const logger = createWorkerLogger();

logger.info('Worker boot — MarketPilot repricer worker starting');

// AD3: master key held in worker-process memory only. Loaded once at boot;
// passed as a parameter to encryptShopApiKey / decryptShopApiKey. Never logged,
// never exported, never written to disk.
let masterKey;
try {
  masterKey = loadMasterKey();
  logger.info(
    { masterKeyByteLength: masterKey.length, masterKeyVersion: 1 },
    'Master key loaded'
  );
} catch (err) {
  logger.error({ code: err.code, message: err.message }, 'Master key load failed — exiting');
  process.exit(1);
}

// Story 2.1: SIGTERM / SIGINT graceful shutdown — closes the service-role pool
// and exits cleanly. Deferred from Story 1.1 (pg Pools never .end()ed).
//
// Failure handling: closeServiceRolePool can reject (pg fails to drain,
// network error mid-end). Without try/catch the unhandled rejection would
// suppress process.exit and leave the worker hung — the worst possible
// SIGTERM outcome (orchestrator escalates to SIGKILL). On error, we exit(1)
// instead of exit(0) so the orchestrator records the failure.
async function shutdown (signal) {
  logger.info({ signal }, 'worker shutting down');
  try {
    await closeServiceRolePool();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'worker shutdown — pool close failed; exiting with code 1');
    process.exit(1);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startHeartbeat(logger);

// Story 5.1: Master 5-min repricing cron.
// dispatchCycle is called by master-cron.js on each tick.
// The in-flight guard is inside master-cron.js itself.
startMasterCron(logger);

// Story 6.2: PRI02 poll cron — every 5 min, polls all pending PRI01 imports
// and resolves their status (COMPLETE → clear state; FAILED → clear + PRI03 parser).
// Independent schedule from master-cron.js; no in-flight guard needed (imports are independent).
startPri02PollCron();

// Story 9.1: Monthly audit_log partition cron.
// Fires on the 28th of each month at 02:00 Lisbon time — creates the partition
// for 2 months ahead (e.g., May 28 → creates July's partition).
// safe: cross-customer cron — Story 9.1's monthly-partition-create.js carries the
// worker-must-filter-by-customer opt-out comment at the top of that file.
//
// Defensive .catch(): runMonthlyPartitionCreate is async; node-cron does not await
// the callback. If the function rejects (e.g. getServiceRoleClient() throws
// synchronously due to missing env, or db.query rejects outside the inner try),
// the rejection would propagate as an unhandledRejection and could destabilise the
// worker process. Catching here turns any escaping rejection into a structured
// log entry so the worker stays up and the next month's cron tick still runs.
cron.schedule(
  '0 2 28 * *',
  () => {
    runMonthlyPartitionCreate(logger).catch((err) => {
      logger.error({ err }, 'monthly-partition-create: cron callback rejected');
    });
  },
  { timezone: 'Europe/Lisbon' }
);

// Story 4.4: Onboarding scan poller — check for PENDING scan_jobs every 5 seconds.
// processNextPendingScan() is a no-op when no PENDING scans exist.
// FOR UPDATE SKIP LOCKED in the query ensures safe concurrent-worker operation.
// Defensive .catch(): processNextPendingScan is async; setInterval does not await
// the callback. If the function rejects (e.g. DB connection lost), the rejection
// would propagate as an unhandledRejection and could destabilise the worker process.
// Catching here turns any escaping rejection into a structured log entry.
let _scanPolling = false;
const SCAN_POLL_INTERVAL_MS = 5_000;

setInterval(() => {
  if (_scanPolling) return; // Prevent overlap if a scan is still running
  _scanPolling = true;
  processNextPendingScan()
    .catch((err) => {
      logger.error({ err }, 'onboarding-scan: scan poller rejected');
    })
    .finally(() => {
      _scanPolling = false;
    });
}, SCAN_POLL_INTERVAL_MS);
