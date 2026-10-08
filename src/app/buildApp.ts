import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { loadConfig, type Config } from './config.js';
import { errorHandler } from './errorHandler.js';
import { healthRoutes } from '../modules/health/routes.js';

export async function buildApp(config: Config = loadConfig()): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, genReqId: () => crypto.randomUUID() });

  await app.register(cors, { origin: config.CORS_ORIGINS.split(',') });

  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes);

  return app;
}
