import Fastify from 'fastify';
import FastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { getEnv } from '../../shared/config/runtime-env.js';
import { healthRoutes } from './routes/health.js';

getEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));

const fastify = Fastify({
  logger: {
    level: 'info',
  },
});

try {
  await fastify.register(FastifyStatic, {
    root: join(__dirname, '../../public'),
    prefix: '/public/',
  });

  await fastify.register(healthRoutes);

  fastify.get('/', async (_request, _reply) => {
    return 'Hello MarketPilot';
  });

  await fastify.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
