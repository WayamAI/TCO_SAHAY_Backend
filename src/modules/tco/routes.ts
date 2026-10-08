import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { buildAuthenticate } from '../../shared/authenticate.js';
import * as tcoService from './service.js';
import { z2j } from '../../shared/zodSchema.js';
import { bearerAuth, dataResponse, errorResponse } from '../../shared/openapiEnvelope.js';

const runSchema = z.object({
  locomotiveId: z.string().min(1),
  horizonYears: z.number().int().positive().max(100).optional(),
  scenarioId: z.string().min(1).optional(),
});

const runIdParamsSchema = z.object({ id: z.string() });
const locomotiveIdParamsSchema = z.object({ id: z.string() });

// TcoRun's inputs/outputs are JSON columns (see DATABASE_MODEL.md) - the
// shape is documented narratively in TCO_ENGINE_SPECIFICATION.md rather than
// re-declared field-by-field here, since LocomotiveTco's row shape already
// has a canonical TypeScript type in engine.ts.
const tcoRunSchema = z.object({}).passthrough();

export async function tcoRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = buildAuthenticate(app.config.JWT_ACCESS_SECRET);

  app.post(
    '/tco/runs',
    {
      preHandler: authenticate,
      schema: {
        tags: ['tco'],
        summary: 'Run the canonical TCO engine for a locomotive and persist the result',
        description:
          'Computes component-level TCO over the given horizon (see TCO_ENGINE_SPECIFICATION.md ' +
          'for how this differs from the frontend\'s Part-level engine) and stores it as a TcoRun.',
        security: bearerAuth,
        body: z2j(runSchema),
        response: { 201: dataResponse(z2j(tcoRunSchema)), 404: errorResponse },
      },
    },
    async (request, reply) => {
      const body = runSchema.parse(request.body);
      const run = await tcoService.runTco(prisma, {
        organizationId: request.user!.organizationId,
        locomotiveId: body.locomotiveId,
        horizonYears: body.horizonYears,
        scenarioId: body.scenarioId,
        userId: request.user!.userId,
      });
      reply.status(201);
      return { data: run };
    },
  );

  app.get(
    '/tco/runs/:id',
    {
      preHandler: authenticate,
      schema: {
        tags: ['tco'],
        summary: 'Re-fetch a previously persisted TCO run',
        security: bearerAuth,
        params: z2j(runIdParamsSchema),
        response: { 200: dataResponse(z2j(tcoRunSchema)), 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const run = await tcoService.getTcoRun(prisma, request.user!.organizationId, id);
      return { data: run };
    },
  );

  app.get(
    '/locomotives/:id/tco-runs',
    {
      preHandler: authenticate,
      schema: {
        tags: ['tco'],
        summary: 'List TCO run history for a locomotive',
        security: bearerAuth,
        params: z2j(locomotiveIdParamsSchema),
        response: { 200: dataResponse({ type: 'array', items: z2j(tcoRunSchema) }), 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const runs = await tcoService.listTcoRunsForLocomotive(prisma, request.user!.organizationId, id);
      return { data: runs };
    },
  );
}
