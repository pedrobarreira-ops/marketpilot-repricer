import Fastify from 'fastify';
import FastifyStatic from '@fastify/static';
import FastifyCookie from '@fastify/cookie';
import FastifyFormbody from '@fastify/formbody';
import FastifyView from '@fastify/view';
import { Eta } from 'eta';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { getEnv } from '../../shared/config/runtime-env.js';
import { getFastifyLoggerOptions, FASTIFY_REQUEST_ID_LOG_LABEL } from '../../shared/logger.js';
import { closeServiceRolePool } from '../../shared/db/service-role-client.js';
import { healthRoutes } from './routes/health.js';
import { publicRoutes } from './routes/_public/index.js';
import { keyRoutes } from './routes/onboarding/key.js';
import { scanRoutes } from './routes/onboarding/scan.js';
import FastifyRateLimit from '@fastify/rate-limit';
import { scanReadyRoutes } from './routes/onboarding/scan-ready.js';
import { marginRoutes } from './routes/onboarding/margin.js';
import { scanFailedRoutes } from './routes/interceptions/scan-failed.js';
import { dashboardRoutes } from './routes/dashboard/index.js';

getEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({
  logger: getFastifyLoggerOptions(),
  requestIdLogLabel: FASTIFY_REQUEST_ID_LOG_LABEL,
  routerOptions: { ignoreTrailingSlash: true },
});

try {
  await fastify.register(FastifyCookie, {
    secret: process.env.COOKIE_SECRET,
    hook: 'onRequest',
    parseOptions: {
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    },
  });

  await fastify.register(FastifyFormbody);

  // Story 4.5: register @fastify/rate-limit globally with global: false so only
  // routes that opt in via config.rateLimit are rate-limited (AC#3 — /status only).
  await fastify.register(FastifyRateLimit, { global: false });

  await fastify.register(FastifyView, {
    engine: { eta: new Eta() },
    templates: join(__dirname, 'views'),
    defaultContext: { appName: 'MarketPilot' },
    propertyName: 'view',
    asyncPropertyName: 'viewAsync',
  });

  await fastify.register(FastifyStatic, {
    root: join(__dirname, '../../public'),
    prefix: '/public/',
  });

  // Story 2.1: graceful shutdown — close service-role pool before Fastify
  // exits. Deferred from Story 1.1 (pg Pools never .end()ed, Story 1.5
  // endFounderAdminPool production shutdown hook).
  fastify.addHook('onClose', async () => {
    await closeServiceRolePool();
  });

  await fastify.register(healthRoutes);
  await fastify.register(publicRoutes);
  await fastify.register(keyRoutes);
  await fastify.register(scanRoutes);
  await fastify.register(scanReadyRoutes);
  // Story 4.8: margin question /onboarding/margin + smart-default mapping + <5% warning
  await fastify.register(marginRoutes);
  // Story 4.6: scan-failed interception route (authenticated, under /scan-failed)
  await fastify.register(scanFailedRoutes);

  // Story 4.9: Dashboard root — extracted route plugin with dry-run minimal landing.
  // Auth + RLS + interception hooks applied inside the plugin scope.
  // Epic 8 stories will expand this to a full state-aware dashboard.
  await fastify.register(dashboardRoutes);

  await fastify.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
