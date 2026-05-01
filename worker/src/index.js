import pino from 'pino';
import { getEnv } from '../../shared/config/runtime-env.js';
import { startHeartbeat } from './jobs/heartbeat.js';

getEnv();

const logger = pino({ level: 'info' });

logger.info('Worker boot — MarketPilot repricer worker starting');

startHeartbeat(logger);
