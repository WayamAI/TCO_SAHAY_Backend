import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { buildAuthenticate } from '../../shared/authenticate.js';
import * as simulationService from './service.js';
import { DEFAULT_ITERATIONS, MAX_ITERATIONS, MIN_ITERATIONS } from './engine.js';
import { z2j } from '../../shared/zodSchema.js';
import { bearerAuth, dataResponse, errorResponse } from '../../shared/openapiEnvelope.js';

const runSchema = z.object({
  locomotiveId: z.string().min(1),
  horizonYears: z.number().int().positive().max(100).optional(),
  scenarioId: z.string().min(1).optional(),
  iterations: z.number().int().min(MIN_ITERATIONS).max(MAX_ITERATIONS).default(DEFAULT_ITERATIONS),
  seed: z.string().min(1).optional(),
});

const runIdParamsSchema = z.object({ id: z.string() });
const locomotiveIdParamsSchema = z.object({ id: z.string() });

// SimulationRun's config/summary/percentiles/histogram are JSON columns -
// documented narratively in SIMULATION_ENGINE_SPECIFICATION.md, same
// convention as TcoRun.inputs/outputs (see tco/routes.ts).
const simulationRunSchema = z.object({}).passthrough();

export async function simulationRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = buildAuthenticate(app.config.JWT_ACCESS_SECRET);

  app.post(
    '/simulation-runs',
    {
      preHandler: authenticate,
      schema: {
        tags: ['simulation'],
        summary: 'Run a Monte Carlo simulation for a locomotive and persist the result',
        description:
          'Re-runs the canonical TCO engine many times with sampled failure-rate and cost ' +
          'multipliers (see SIMULATION_ENGINE_SPECIFICATION.md) and stores the resulting ' +
          'totalCost distribution as a SimulationRun, distinct from a deterministic TcoRun.',
        security: bearerAuth,
        body: z2j(runSchema),
        response: { 201: dataResponse(z2j(simulationRunSchema)), 404: errorResponse, 400: errorResponse },
      },
    },
    async (request, reply) => {
      const body = runSchema.parse(request.body);
      const run = await simulationService.runLocomotiveSimulation(prisma, {
        organizationId: request.user!.organizationId,
        locomotiveId: body.locomotiveId,
        horizonYears: body.horizonYears,
        scenarioId: body.scenarioId,
        iterations: body.iterations,
        seed: body.seed,
        userId: request.user!.userId,
      });
      reply.status(201);
      return { data: run };
    },
  );

  app.get(
    '/simulation-runs/:id',
    {
      preHandler: authenticate,
      schema: {
        tags: ['simulation'],
        summary: 'Re-fetch a previously persisted simulation run',
        security: bearerAuth,
        params: z2j(runIdParamsSchema),
        response: { 200: dataResponse(z2j(simulationRunSchema)), 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const run = await simulationService.getSimulationRun(prisma, request.user!.organizationId, id);
      return { data: run };
    },
  );

  app.get(
    '/locomotives/:id/simulation-runs',
    {
      preHandler: authenticate,
      schema: {
        tags: ['simulation'],
        summary: 'List simulation run history for a locomotive',
        security: bearerAuth,
        params: z2j(locomotiveIdParamsSchema),
        response: { 200: dataResponse({ type: 'array', items: z2j(simulationRunSchema) }), 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const runs = await simulationService.listSimulationRunsForLocomotive(prisma, request.user!.organizationId, id);
      return { data: runs };
    },
  );
}
