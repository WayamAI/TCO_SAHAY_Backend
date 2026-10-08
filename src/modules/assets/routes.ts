import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { buildAuthenticate, requireRole } from '../../shared/authenticate.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import { paginationArgs, paginationMeta, paginationSchema } from '../../shared/pagination.js';

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

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = buildAuthenticate(app.config.JWT_ACCESS_SECRET);
  const orgId = (request: { user?: { organizationId: string } }) => request.user!.organizationId;

  app.get('/locomotives', { preHandler: authenticate }, async (request) => {
    const pagination = paginationSchema.parse(request.query);
    const { fleetId } = request.query as { fleetId?: string };
    const where = { organizationId: orgId(request), ...(fleetId ? { fleetId } : {}), deletedAt: null };
    const [items, total] = await Promise.all([
      prisma.locomotive.findMany({ where, ...paginationArgs(pagination), orderBy: { createdAt: 'desc' } }),
      prisma.locomotive.count({ where }),
    ]);
    return { data: items, meta: paginationMeta(pagination, total) };
  });

  app.post(
    '/locomotives',
    { preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')] },
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

  app.get('/locomotives/:id', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    const locomotive = await prisma.locomotive.findFirst({
      where: { id, organizationId: orgId(request), deletedAt: null },
      include: { systems: { include: { assemblies: { include: { components: true } } } } },
    });
    if (!locomotive) throw new NotFoundError('Locomotive');
    return { data: locomotive };
  });

  app.patch(
    '/locomotives/:id',
    { preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = locomotiveUpdateSchema.parse(request.body);
      const existing = await prisma.locomotive.findFirst({
        where: { id, organizationId: orgId(request), deletedAt: null },
      });
      if (!existing) throw new NotFoundError('Locomotive');
      const locomotive = await prisma.locomotive.update({ where: { id }, data: body });
      return { data: locomotive };
    },
  );

  app.delete(
    '/locomotives/:id',
    { preHandler: [authenticate, requireRole('ADMIN')] },
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

  app.get('/locomotives/:id/components', { preHandler: authenticate }, async (request) => {
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
  });

  app.post(
    '/locomotives/:id/components',
    { preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')] },
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
    { preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = componentSchema.partial().parse(request.body);
      const existing = await prisma.component.findFirst({
        where: { id, organizationId: orgId(request), deletedAt: null },
      });
      if (!existing) throw new NotFoundError('Component');
      const component = await prisma.component.update({ where: { id }, data: body });
      return { data: component };
    },
  );

  app.delete(
    '/components/:id',
    { preHandler: [authenticate, requireRole('ADMIN')] },
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
