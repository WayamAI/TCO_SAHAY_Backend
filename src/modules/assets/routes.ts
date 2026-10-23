import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { buildAuthenticate, requireRole } from '../../shared/authenticate.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { paginationArgs, paginationMeta, paginationSchema } from '../../shared/pagination.js';
import { z2j } from '../../shared/zodSchema.js';
import { bearerAuth, dataResponse, errorResponse } from '../../shared/openapiEnvelope.js';

const locomotiveSchema = z.object({
  fleetId: z.string().min(1),
  operatingProfileId: z.string().min(1),
  model: z.string().min(1),
  manufacturer: z.string().min(1),
  type: z.string().min(1),
  horsepower: z.number().nonnegative(),
  purchaseCost: z.number().nonnegative(),
  commissionYear: z.number().int(),
  plannedLifeYears: z.number().int().positive(),
  annualKm: z.number().nonnegative(),
  annualHours: z.number().nonnegative(),
  fuelType: z.string().min(1),
  fuelCostPerUnit: z.number().nonnegative(),
  status: z.string().min(1),
});

const locomotiveUpdateSchema = locomotiveSchema.partial();

const systemNodeSchema = z.object({
  name: z.string().min(1),
  icon: z.string().min(1),
  criticality: z.string().min(1),
});

const assemblySchema = z.object({
  name: z.string().min(1),
});

const componentSchema = z.object({
  assemblyId: z.string().uuid(),
  name: z.string().min(1),
  purchaseCost: z.number().nonnegative(),
  replacementCost: z.number().nonnegative(),
  lifeYears: z.number().positive(),
  mtbfHours: z.number().positive(),
  weibullBeta: z.number().positive(),
  weibullEta: z.number().positive(),
  mttrHours: z.number().nonnegative(),
  warrantyYears: z.number().nonnegative(),
  laborCostPct: z.number().min(0).max(100),
  failureImpact: z.string().min(1),
  category: z.string().min(1),
  downtimeCostPerDay: z.number().nonnegative(),
});

const idParamsSchema = z.object({ id: z.string() });

// Loose object - Prisma row shape, not re-declared field-by-field here to
// avoid duplicating prisma/schema.prisma as a second source of truth.
const entitySchema = z.object({}).passthrough();

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = buildAuthenticate(app.config.JWT_ACCESS_SECRET);
  const orgId = (request: { user?: { organizationId: string } }) => request.user!.organizationId;

  app.get(
    '/locomotives',
    {
      preHandler: authenticate,
      schema: {
        tags: ['assets'],
        summary: 'List locomotives, optionally filtered by fleetId',
        security: bearerAuth,
        response: { 200: dataResponse({ type: 'array', items: z2j(entitySchema) }) },
      },
    },
    async (request) => {
      const pagination = paginationSchema.parse(request.query);
      const { fleetId } = request.query as { fleetId?: string };
      const where = { organizationId: orgId(request), ...(fleetId ? { fleetId } : {}), deletedAt: null };
      const [items, total] = await Promise.all([
        prisma.locomotive.findMany({ where, ...paginationArgs(pagination), orderBy: { createdAt: 'desc' } }),
        prisma.locomotive.count({ where }),
      ]);
      return { data: items, meta: paginationMeta(pagination, total) };
    },
  );

  app.post(
    '/locomotives',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')],
      schema: {
        tags: ['assets'],
        summary: 'Create a locomotive',
        security: bearerAuth,
        body: z2j(locomotiveSchema),
        response: { 201: dataResponse(z2j(entitySchema)), 400: errorResponse, 403: errorResponse, 404: errorResponse },
      },
    },
    async (request, reply) => {
      const body = locomotiveSchema.parse(request.body);
      if (body.commissionYear > new Date().getFullYear()) {
        throw new ValidationError('commissionYear cannot be in the future');
      }
      const fleet = await prisma.fleet.findFirst({
        where: { id: body.fleetId, organizationId: orgId(request) },
      });
      if (!fleet) throw new NotFoundError('Fleet');
      await assertOwnedOperatingProfile(body.operatingProfileId, orgId(request));

      const locomotive = await prisma.locomotive.create({
        data: { ...body, organizationId: orgId(request) },
      });
      reply.status(201);
      return { data: locomotive };
    },
  );

  app.get(
    '/locomotives/:id',
    {
      preHandler: authenticate,
      schema: {
        tags: ['assets'],
        summary: 'Get a locomotive with its full system/assembly/component tree',
        security: bearerAuth,
        params: z2j(idParamsSchema),
        response: { 200: dataResponse(z2j(entitySchema)), 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const locomotive = await prisma.locomotive.findFirst({
        where: { id, organizationId: orgId(request), deletedAt: null },
        include: { systems: { include: { assemblies: { include: { components: true } } } } },
      });
      if (!locomotive) throw new NotFoundError('Locomotive');
      return { data: locomotive };
    },
  );

  app.patch(
    '/locomotives/:id',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')],
      schema: {
        tags: ['assets'],
        summary: 'Update a locomotive',
        security: bearerAuth,
        params: z2j(idParamsSchema),
        body: z2j(locomotiveUpdateSchema),
        response: { 200: dataResponse(z2j(entitySchema)), 403: errorResponse, 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = locomotiveUpdateSchema.parse(request.body);
      const existing = await prisma.locomotive.findFirst({
        where: { id, organizationId: orgId(request), deletedAt: null },
      });
      if (!existing) throw new NotFoundError('Locomotive');
      if (body.fleetId !== undefined) {
        const fleet = await prisma.fleet.findFirst({
          where: { id: body.fleetId, organizationId: orgId(request) },
        });
        if (!fleet) throw new NotFoundError('Fleet');
      }
      if (body.operatingProfileId !== undefined) {
        await assertOwnedOperatingProfile(body.operatingProfileId, orgId(request));
      }
      const locomotive = await prisma.locomotive.update({ where: { id }, data: body });
      return { data: locomotive };
    },
  );

  app.delete(
    '/locomotives/:id',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
      schema: {
        tags: ['assets'],
        summary: 'Soft-delete a locomotive (ADMIN only)',
        security: bearerAuth,
        params: z2j(idParamsSchema),
        response: { 200: dataResponse(), 403: errorResponse, 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.locomotive.findFirst({
        where: { id, organizationId: orgId(request), deletedAt: null },
      });
      if (!existing) throw new NotFoundError('Locomotive');
      await prisma.locomotive.update({ where: { id }, data: { deletedAt: new Date() } });
      return { data: { id, deleted: true } };
    },
  );

  app.post(
    '/locomotives/:id/systems',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')],
      schema: {
        tags: ['assets'],
        summary: 'Add a system node to a locomotive',
        security: bearerAuth,
        params: z2j(idParamsSchema),
        body: z2j(systemNodeSchema),
        response: { 201: dataResponse(z2j(entitySchema)), 404: errorResponse },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = systemNodeSchema.parse(request.body);
      const locomotive = await prisma.locomotive.findFirst({
        where: { id, organizationId: orgId(request), deletedAt: null },
      });
      if (!locomotive) throw new NotFoundError('Locomotive');
      const system = await prisma.systemNode.create({
        data: { ...body, locomotiveId: id, organizationId: orgId(request) },
      });
      reply.status(201);
      return { data: system };
    },
  );

  app.post(
    '/locomotives/:id/systems/:systemId/assemblies',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')],
      schema: {
        tags: ['assets'],
        summary: 'Add an assembly to a system node',
        security: bearerAuth,
        params: z2j(z.object({ id: z.string(), systemId: z.string() })),
        body: z2j(assemblySchema),
        response: { 201: dataResponse(z2j(entitySchema)), 404: errorResponse },
      },
    },
    async (request, reply) => {
      const { id, systemId } = request.params as { id: string; systemId: string };
      const body = assemblySchema.parse(request.body);
      const system = await prisma.systemNode.findFirst({
        where: { id: systemId, organizationId: orgId(request), locomotiveId: id },
      });
      if (!system) throw new NotFoundError('SystemNode');
      const assembly = await prisma.assembly.create({
        data: { ...body, systemNodeId: systemId, organizationId: orgId(request) },
      });
      reply.status(201);
      return { data: assembly };
    },
  );

  app.get(
    '/locomotives/:id/components',
    {
      preHandler: authenticate,
      schema: {
        tags: ['assets'],
        summary: 'List a locomotive’s components with dependency edges',
        security: bearerAuth,
        params: z2j(idParamsSchema),
        response: { 200: dataResponse({ type: 'array', items: z2j(entitySchema) }), 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const locomotive = await prisma.locomotive.findFirst({
        where: { id, organizationId: orgId(request), deletedAt: null },
      });
      if (!locomotive) throw new NotFoundError('Locomotive');
      const components = await prisma.component.findMany({
        where: { organizationId: orgId(request), assembly: { systemNode: { locomotiveId: id } }, deletedAt: null },
        include: { dependsOn: true },
      });
      return { data: components };
    },
  );

  app.post(
    '/locomotives/:id/components',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')],
      schema: {
        tags: ['assets'],
        summary: 'Add a component to a locomotive',
        security: bearerAuth,
        params: z2j(idParamsSchema),
        body: z2j(componentSchema),
        response: { 201: dataResponse(z2j(entitySchema)), 404: errorResponse },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = componentSchema.parse(request.body);
      const assembly = await prisma.assembly.findFirst({
        where: {
          id: body.assemblyId,
          organizationId: orgId(request),
          systemNode: { locomotiveId: id },
        },
      });
      if (!assembly) throw new NotFoundError('Assembly');
      const component = await prisma.component.create({
        data: { ...body, organizationId: orgId(request) },
      });
      reply.status(201);
      return { data: component };
    },
  );

  app.patch(
    '/components/:id',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')],
      schema: {
        tags: ['assets'],
        summary: 'Update a component',
        security: bearerAuth,
        params: z2j(idParamsSchema),
        body: z2j(componentSchema.partial()),
        response: { 200: dataResponse(z2j(entitySchema)), 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = componentSchema.partial().parse(request.body);
      const existing = await prisma.component.findFirst({
        where: { id, organizationId: orgId(request), deletedAt: null },
      });
      if (!existing) throw new NotFoundError('Component');
      if (body.assemblyId !== undefined) {
        const assembly = await prisma.assembly.findFirst({
          where: { id: body.assemblyId, organizationId: orgId(request) },
        });
        if (!assembly) throw new NotFoundError('Assembly');
      }
      const component = await prisma.component.update({ where: { id }, data: body });
      return { data: component };
    },
  );

  app.delete(
    '/components/:id',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
      schema: {
        tags: ['assets'],
        summary: 'Soft-delete a component (ADMIN only)',
        security: bearerAuth,
        params: z2j(idParamsSchema),
        response: { 200: dataResponse(), 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const existing = await prisma.component.findFirst({
        where: { id, organizationId: orgId(request), deletedAt: null },
      });
      if (!existing) throw new NotFoundError('Component');
      await prisma.component.update({ where: { id }, data: { deletedAt: new Date() } });
      return { data: { id, deleted: true } };
    },
  );
}

async function assertOwnedOperatingProfile(id: string, organizationId: string): Promise<void> {
  const found = await prisma.operatingProfile.findFirst({
    where: { id, OR: [{ organizationId: null }, { organizationId }] },
  });
  if (!found) throw new NotFoundError('OperatingProfile');
}
