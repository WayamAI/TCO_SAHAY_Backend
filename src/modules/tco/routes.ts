import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { buildAuthenticate } from '../../shared/authenticate.js';
import * as tcoService from './service.js';

const runSchema = z.object({
  locomotiveId: z.string().min(1),
  horizonYears: z.number().int().positive().max(100),
});

export async function tcoRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = buildAuthenticate(app.config.JWT_ACCESS_SECRET);

  app.post('/tco/runs', { preHandler: authenticate }, async (request, reply) => {
    const body = runSchema.parse(request.body);
    const run = await tcoService.runTco(prisma, {
      organizationId: request.user!.organizationId,
      locomotiveId: body.locomotiveId,
      horizonYears: body.horizonYears,
      userId: request.user!.userId,
    });
    reply.status(201);
    return { data: run };
  });

  app.get('/tco/runs/:id', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    const run = await tcoService.getTcoRun(prisma, request.user!.organizationId, id);
    return { data: run };
  });

  app.get('/locomotives/:id/tco-runs', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    const runs = await tcoService.listTcoRunsForLocomotive(prisma, request.user!.organizationId, id);
    return { data: runs };
  });
}
