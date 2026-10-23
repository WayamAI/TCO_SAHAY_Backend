import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { buildAuthenticate, requireRole } from '../../shared/authenticate.js';
import { NotFoundError } from '../../shared/errors.js';
import { paginationArgs, paginationMeta, paginationSchema } from '../../shared/pagination.js';
import { z2j } from '../../shared/zodSchema.js';
import { bearerAuth, dataResponse, errorResponse } from '../../shared/openapiEnvelope.js';

const maintenanceScheduleSchema = z.object({
  name: z.string().min(1),
  triggerMonths: z.number().positive().optional(),
  triggerKm: z.number().positive().optional(),
  triggerHours: z.number().positive().optional(),
  rule: z.string().min(1),
  laborHours: z.number().nonnegative(),
  laborRatePerHour: z.number().nonnegative(),
  partsEstimate: z.number().nonnegative(),
  type: z.enum(['PREVENTIVE', 'OVERHAUL', 'REBUILD']),
});

const costRecordSchema = z.object({
  year: z.number().int(),
  category: z.enum([
    'CAPEX', 'MAINTENANCE', 'CONSUMABLE', 'LABOR', 'FAILURE', 'WARRANTY', 'FUEL', 'DOWNTIME',
  ]),
  amount: z.number(),
});

const costRecordQuerySchema = z.object({
  year: z.coerce.number().int().optional(),
  category: costRecordSchema.shape.category.optional(),
});

const locomotiveIdParamsSchema = z.object({ id: z.string() });
const scheduleIdParamsSchema = z.object({ scheduleId: z.string() });

// Loose object - Prisma row shape, not re-declared field-by-field here to
// avoid duplicating prisma/schema.prisma as a second source of truth.
const entitySchema = z.object({}).passthrough();

async function assertLocomotiveOwned(locomotiveId: string, organizationId: string): Promise<void> {
  const found = await prisma.locomotive.findFirst({
    where: { id: locomotiveId, organizationId, deletedAt: null },
  });
  if (!found) throw new NotFoundError('Locomotive');
}

export async function costRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = buildAuthenticate(app.config.JWT_ACCESS_SECRET);
  const orgId = (request: { user?: { organizationId: string } }) => request.user!.organizationId;

  app.get(
    '/locomotives/:id/maintenance-schedules',
    {
      preHandler: authenticate,
      schema: {
        tags: ['costs'],
        summary: "List a locomotive's maintenance schedules",
        security: bearerAuth,
        params: z2j(locomotiveIdParamsSchema),
        response: { 200: dataResponse({ type: 'array', items: z2j(entitySchema) }), 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      await assertLocomotiveOwned(id, orgId(request));
      const schedules = await prisma.maintenanceSchedule.findMany({ where: { locomotiveId: id } });
      return { data: schedules };
    },
  );

  app.post(
    '/locomotives/:id/maintenance-schedules',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')],
      schema: {
        tags: ['costs'],
        summary: 'Create a maintenance schedule for a locomotive',
        security: bearerAuth,
        params: z2j(locomotiveIdParamsSchema),
        body: z2j(maintenanceScheduleSchema),
        response: { 201: dataResponse(z2j(entitySchema)), 404: errorResponse },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await assertLocomotiveOwned(id, orgId(request));
      const body = maintenanceScheduleSchema.parse(request.body);
      const schedule = await prisma.maintenanceSchedule.create({
        data: { ...body, locomotiveId: id, organizationId: orgId(request) },
      });
      reply.status(201);
      return { data: schedule };
    },
  );

  app.patch(
    '/maintenance-schedules/:scheduleId',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')],
      schema: {
        tags: ['costs'],
        summary: 'Update a maintenance schedule',
        security: bearerAuth,
        params: z2j(scheduleIdParamsSchema),
        body: z2j(maintenanceScheduleSchema.partial()),
        response: { 200: dataResponse(z2j(entitySchema)), 404: errorResponse },
      },
    },
    async (request) => {
      const { scheduleId } = request.params as { scheduleId: string };
      const existing = await prisma.maintenanceSchedule.findFirst({
        where: { id: scheduleId, organizationId: orgId(request) },
      });
      if (!existing) throw new NotFoundError('MaintenanceSchedule');
      const body = maintenanceScheduleSchema.partial().parse(request.body);
      const schedule = await prisma.maintenanceSchedule.update({ where: { id: scheduleId }, data: body });
      return { data: schedule };
    },
  );

  app.delete(
    '/maintenance-schedules/:scheduleId',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
      schema: {
        tags: ['costs'],
        summary: 'Delete a maintenance schedule (ADMIN only)',
        security: bearerAuth,
        params: z2j(scheduleIdParamsSchema),
        response: { 200: dataResponse(), 404: errorResponse },
      },
    },
    async (request) => {
      const { scheduleId } = request.params as { scheduleId: string };
      const existing = await prisma.maintenanceSchedule.findFirst({
        where: { id: scheduleId, organizationId: orgId(request) },
      });
      if (!existing) throw new NotFoundError('MaintenanceSchedule');
      await prisma.maintenanceSchedule.delete({ where: { id: scheduleId } });
      return { data: { id: scheduleId, deleted: true } };
    },
  );

  app.get(
    '/locomotives/:id/cost-records',
    {
      preHandler: authenticate,
      schema: {
        tags: ['costs'],
        summary: "List a locomotive's cost records, filterable by year/category",
        security: bearerAuth,
        params: z2j(locomotiveIdParamsSchema),
        response: { 200: dataResponse({ type: 'array', items: z2j(entitySchema) }), 404: errorResponse },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      await assertLocomotiveOwned(id, orgId(request));
      const pagination = paginationSchema.parse(request.query);
      const { year, category } = costRecordQuerySchema.parse(request.query);
      const where = {
        locomotiveId: id,
        organizationId: orgId(request),
        ...(year !== undefined ? { year } : {}),
        ...(category ? { category } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.costRecord.findMany({ where, ...paginationArgs(pagination), orderBy: { year: 'desc' } }),
        prisma.costRecord.count({ where }),
      ]);
      return { data: items, meta: paginationMeta(pagination, total) };
    },
  );

  app.post(
    '/locomotives/:id/cost-records',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')],
      schema: {
        tags: ['costs'],
        summary: 'Append a cost record (ledger - no update/delete, corrections are new rows)',
        security: bearerAuth,
        params: z2j(locomotiveIdParamsSchema),
        body: z2j(costRecordSchema),
        response: { 201: dataResponse(z2j(entitySchema)), 404: errorResponse },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await assertLocomotiveOwned(id, orgId(request));
      const body = costRecordSchema.parse(request.body);
      const record = await prisma.costRecord.create({
        data: { ...body, locomotiveId: id, organizationId: orgId(request) },
      });
      reply.status(201);
      return { data: record };
    },
  );
}
