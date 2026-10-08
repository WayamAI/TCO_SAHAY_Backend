import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { buildAuthenticate, requireRole } from '../../shared/authenticate.js';
import { NotFoundError } from '../../shared/errors.js';
import { paginationArgs, paginationMeta, paginationSchema } from '../../shared/pagination.js';
import { z2j } from '../../shared/zodSchema.js';
import { bearerAuth, dataResponse, errorResponse } from '../../shared/openapiEnvelope.js';

// Field names mirror the frontend's Scenario interface (syntheticData.ts) 1:1
// for a future UI mapping, even though several are not yet applied by the
// TCO engine - see TCO_ENGINE_SPECIFICATION.md's "Scenario application" table.
const scenarioSchema = z.object({
  name: z.string().min(1),
  planningHorizonYears: z.number().int().positive().max(100),
  discountRate: z.number(),
  laborRate: z.number().nonnegative(),
  maintenanceIntervalMultiplier: z.number().positive(),
  failureRateMultiplier: z.number().positive(),
  warrantyExtendedYears: z.number().nonnegative(),
  fuelCostPerLiter: z.number().nonnegative(),
  inflationEnabled: z.boolean(),
  includeDowntime: z.boolean(),
  operatingProfileId: z.string().min(1).optional(),
});

const scenarioUpdateSchema = scenarioSchema.partial();

const idParamsSchema = z.object({ id: z.string() });

// Loose object - Prisma row shape, not re-declared field-by-field here to
// avoid duplicating prisma/schema.prisma as a second source of truth.
const entitySchema = z.object({}).passthrough();

async function assertOwnedOperatingProfile(id: string, organizationId: string): Promise<void> {
  const found = await prisma.operatingProfile.findFirst({
    where: { id, OR: [{ organizationId: null }, { organizationId }] },
  });
  if (!found) throw new NotFoundError('OperatingProfile');
}

export async function scenarioRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = buildAuthenticate(app.config.JWT_ACCESS_SECRET);
  const orgId = (request: { user?: { organizationId: string } }) => request.user!.organizationId;

  app.get(
    '/scenarios',
    {
      preHandler: authenticate,
      schema: {
        tags: ['scenarios'],
        summary: "List the caller's scenarios, paginated",
        security: bearerAuth,
        response: { 200: dataResponse({ type: 'array', items: z2j(entitySchema) }) },
      },
    },
    async (request) => {
      const pagination = paginationSchema.parse(request.query);
      const where = { organizationId: orgId(request) };
      const [items, total] = await Promise.all([
        prisma.scenario.findMany({ where, ...paginationArgs(pagination), orderBy: { createdAt: 'desc' } }),
        prisma.scenario.count({ where }),
      ]);
      return { data: items, meta: paginationMeta(pagination, total) };
    },
  );

  app.post(
    '/scenarios',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')],
      schema: {
        tags: ['scenarios'],
        summary: 'Create a scenario',
        security: bearerAuth,
        body: z2j(scenarioSchema),
        response: { 201: dataResponse(z2j(entitySchema)), 403: errorResponse, 404: errorResponse },
      },
    },
    async (request, reply) => {
      const body = scenarioSchema.parse(request.body);
      if (body.operatingProfileId) {
        await assertOwnedOperatingProfile(body.operatingProfileId, orgId(request));
      }
      const scenario = await prisma.scenario.create({
        data: { ...body, organizationId: orgId(request) },
      });
      reply.status(201);
      return { data: scenario };
    },
  );

  app.get(
    '/scenarios/:id',
    {
      preHandler: authenticate,
      schema: {
        tags: ['scenarios'],
        summary: 'Get a scenario by id',
        security: bearerAuth,
        params: z2j(idParamsSchema),
        response: { 200: dataResponse(z2j(entitySchema)), 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const scenario = await prisma.scenario.findFirst({ where: { id, organizationId: orgId(request) } });
      if (!scenario) throw new NotFoundError('Scenario');
      return { data: scenario };
    },
  );

  app.patch(
    '/scenarios/:id',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')],
      schema: {
        tags: ['scenarios'],
        summary: 'Update a scenario',
        security: bearerAuth,
        params: z2j(idParamsSchema),
        body: z2j(scenarioUpdateSchema),
        response: { 200: dataResponse(z2j(entitySchema)), 403: errorResponse, 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.scenario.findFirst({ where: { id, organizationId: orgId(request) } });
      if (!existing) throw new NotFoundError('Scenario');
      const body = scenarioUpdateSchema.parse(request.body);
      if (body.operatingProfileId) {
        await assertOwnedOperatingProfile(body.operatingProfileId, orgId(request));
      }
      const scenario = await prisma.scenario.update({ where: { id }, data: body });
      return { data: scenario };
    },
  );

  app.delete(
    '/scenarios/:id',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
      schema: {
        tags: ['scenarios'],
        summary: 'Delete a scenario (ADMIN only, hard delete)',
        security: bearerAuth,
        params: z2j(idParamsSchema),
        response: { 200: dataResponse(), 403: errorResponse, 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.scenario.findFirst({ where: { id, organizationId: orgId(request) } });
      if (!existing) throw new NotFoundError('Scenario');
      await prisma.scenario.delete({ where: { id } });
      return { data: { id, deleted: true } };
    },
  );
}
