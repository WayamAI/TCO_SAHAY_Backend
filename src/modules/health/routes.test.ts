import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { healthRoutes } from './routes.js';

vi.mock('../../db/client.js', () => ({
  prisma: { $queryRaw: vi.fn().mockResolvedValue([{ '1': 1 }]) },
}));

describe('health routes', () => {
  it('GET /health returns ok', async () => {
    const app = Fastify();
    await app.register(healthRoutes);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'ok' } });
  });

  it('GET /ready returns ready when db responds', async () => {
    const app = Fastify();
    await app.register(healthRoutes);
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'ready' } });
  });
});
