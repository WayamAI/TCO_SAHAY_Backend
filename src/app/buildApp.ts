import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { loadConfig, type Config } from './config.js';
import { errorHandler } from './errorHandler.js';
import { healthRoutes } from '../modules/health/routes.js';
import { authRoutes } from '../modules/auth/routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
  }
}

export async function buildApp(config: Config = loadConfig()): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, genReqId: () => crypto.randomUUID() });
  app.decorate('config', config);

  await app.register(cors, { origin: config.CORS_ORIGINS.split(',') });

  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api/v1' });

  return app;
}
