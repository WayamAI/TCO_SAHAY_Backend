import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/client.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ data: { status: 'ok' } }));

  app.get('/ready', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { data: { status: 'ready' } };
    } catch (err) {
      reply.status(503);
      return { error: { code: 'NOT_READY', message: 'Database unreachable', details: {} } };
    }
  });
}
