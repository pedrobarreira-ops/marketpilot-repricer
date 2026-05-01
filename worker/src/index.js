import pino from 'pino';
import { getEnv } from '../../shared/config/runtime-env.js';
import { loadMasterKey } from '../../shared/crypto/master-key-loader.js';
import { startHeartbeat } from './jobs/heartbeat.js';

getEnv();

const logger = pino({ level: 'info' });

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

startHeartbeat(logger);
