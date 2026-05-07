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
import { scanFailedRoutes } from './routes/interceptions/scan-failed.js';
import { authMiddleware } from './middleware/auth.js';
import { rlsContext, releaseRlsClient } from './middleware/rls-context.js';
import { interceptionRedirect } from './middleware/interception-redirect.js';

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
  // Story 4.6: scan-failed interception route (authenticated, under /scan-failed)
  await fastify.register(scanFailedRoutes);

  // Dashboard root — authenticated with interception redirect middleware (Story 4.6 UX-DR3).
  // Auth + RLS context applied as preHandler hooks; interceptionRedirect runs after
  // auth + RLS so it has access to req.user and req.db.
  // Epic 8 stories will expand this to a full dashboard handler.
  await fastify.register(async function dashboardRoutes (instance) {
    instance.addHook('preHandler', authMiddleware);
    instance.addHook('preHandler', rlsContext);
    instance.addHook('preHandler', interceptionRedirect);
    instance.addHook('onResponse', releaseRlsClient);

    instance.get('/', async (_request, _reply) => {
      return 'Hello MarketPilot';
    });
  });

  await fastify.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
