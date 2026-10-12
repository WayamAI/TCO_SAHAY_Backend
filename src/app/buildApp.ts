import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { loadConfig, type Config } from './config.js';
import { errorHandler } from './errorHandler.js';
import { healthRoutes } from '../modules/health/routes.js';
import { authRoutes } from '../modules/auth/routes.js';
import { organizationRoutes } from '../modules/organizations/routes.js';
import { userRoutes } from '../modules/users/routes.js';
import { fleetRoutes } from '../modules/fleets/routes.js';
import { assetRoutes } from '../modules/assets/routes.js';
import { costRoutes } from '../modules/costs/routes.js';
import { tcoRoutes } from '../modules/tco/routes.js';
import { scenarioRoutes } from '../modules/scenarios/routes.js';
import { simulationRoutes } from '../modules/simulation/routes.js';
import { registerOpenApi } from './openapi.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
  }
}

export async function buildApp(config: Config = loadConfig()): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, genReqId: () => crypto.randomUUID() });
  app.decorate('config', config);

  await app.register(cors, { origin: config.CORS_ORIGINS.split(',') });

  // global: false - only routes that opt in via `config: { rateLimit }` are
  // throttled (currently /auth/login and /auth/register). `trustProxy` is
  // never set on the Fastify instance above, so this always keys off the
  // actual socket address, never a spoofable X-Forwarded-For header.
  await app.register(rateLimit, { global: false });

  app.setErrorHandler(errorHandler);

  await registerOpenApi(app);

  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/api/v1' });
  await app.register(organizationRoutes, { prefix: '/api/v1' });
  await app.register(userRoutes, { prefix: '/api/v1' });
  await app.register(fleetRoutes, { prefix: '/api/v1' });
  await app.register(assetRoutes, { prefix: '/api/v1' });
  await app.register(costRoutes, { prefix: '/api/v1' });
  await app.register(tcoRoutes, { prefix: '/api/v1' });
  await app.register(scenarioRoutes, { prefix: '/api/v1' });
  await app.register(simulationRoutes, { prefix: '/api/v1' });

  return app;
}
