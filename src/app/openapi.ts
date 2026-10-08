import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  // Route schemas below are documentation only - request validation stays
  // on the existing manual zod .parse() calls in each handler, so this never
  // changes API behavior. A no-op validator compiler keeps Fastify/ajv from
  // also enforcing the attached JSON schemas.
  app.setValidatorCompiler(() => () => true);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'TCO Backend API',
        description: 'SAHAY locomotive fleet TCO intelligence platform backend.',
        version: '0.1.0',
      },
      servers: [{ url: '/api/v1' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      tags: [
        { name: 'health' },
        { name: 'auth' },
        { name: 'organizations' },
        { name: 'users' },
        { name: 'fleets' },
        { name: 'assets' },
        { name: 'costs' },
        { name: 'tco' },
      ],
    },
  });

  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
}
