import { getEnv } from '../../shared/config/runtime-env.js';
import { loadMasterKey } from '../../shared/crypto/master-key-loader.js';
import { createWorkerLogger } from '../../shared/logger.js';
import { startHeartbeat } from './jobs/heartbeat.js';
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
