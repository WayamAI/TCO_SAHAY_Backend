import { describe, expect, it } from 'vitest';
import { buildApp } from './buildApp.js';
import { loadConfig } from './config.js';

const config = loadConfig({
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_ACCESS_SECRET: 'test-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  CORS_ORIGINS: 'http://localhost:3000',
  PORT: '8092',
});

describe('OpenAPI integration', () => {
  it('serves the generated specification at /openapi.json', async () => {
    const app = await buildApp(config);
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('TCO Backend API');
  });

  it('serves the Swagger UI at /docs', async () => {
    const app = await buildApp(config);
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('represents every existing route group in the generated paths', async () => {
    const app = await buildApp(config);
    const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json();
    const paths = Object.keys(spec.paths);

    for (const expected of [
      '/auth/register',
      '/auth/login',
      '/organizations/me',
      '/users',
      '/fleets',
      '/operating-profiles',
      '/locomotives',
      '/locomotives/:id/components',
      '/locomotives/:id/maintenance-schedules',
      '/locomotives/:id/cost-records',
      '/tco/runs',
      '/locomotives/:id/tco-runs',
      '/scenarios',
      '/scenarios/:id',
      '/simulation-runs',
      '/simulation-runs/:id',
      '/locomotives/:id/simulation-runs',
    ]) {
      // Fastify's openapi plugin rewrites :param to {param} in the spec.
      const asOpenApiPath = expected.replace(/:([a-zA-Z]+)/g, '{$1}');
      expect(paths).toContain(asOpenApiPath);
    }
  });

  it('documents authentication (bearer security scheme) on a protected route', async () => {
    const app = await buildApp(config);
    const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json();
    expect(spec.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    const fleetsGet = spec.paths['/fleets'].get;
    expect(fleetsGet.security).toEqual([{ bearerAuth: [] }]);
  });

  it('documents the TCO run endpoint with request and response schemas', async () => {
    const app = await buildApp(config);
    const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json();
    const tcoRun = spec.paths['/tco/runs'].post;
    expect(tcoRun).toBeDefined();
    expect(tcoRun.tags).toContain('tco');

    const requestSchema =
      tcoRun.requestBody.content['application/json'].schema;
    expect(requestSchema.properties.locomotiveId).toBeDefined();
    expect(requestSchema.properties.horizonYears).toBeDefined();

    const response201 = tcoRun.responses['201'].content['application/json'].schema;
    expect(response201.properties.data).toBeDefined();
  });

  it('documents validation, auth, and not-found error responses somewhere in the spec', async () => {
    const app = await buildApp(config);
    const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json();
    const register = spec.paths['/auth/register'].post;
    expect(register.responses['409']).toBeDefined();

    const fleetById = spec.paths['/fleets/{fleetId}'].get;
    expect(fleetById.responses['404']).toBeDefined();
  });
});
