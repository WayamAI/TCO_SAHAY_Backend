import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { buildAuthenticate, requireRole } from '../../shared/authenticate.js';
import { NotFoundError } from '../../shared/errors.js';
import { paginationArgs, paginationMeta, paginationSchema } from '../../shared/pagination.js';

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

async function assertLocomotiveOwned(locomotiveId: string, organizationId: string): Promise<void> {
  const found = await prisma.locomotive.findFirst({
    where: { id: locomotiveId, organizationId, deletedAt: null },
  });
  if (!found) throw new NotFoundError('Locomotive');
}

export async function costRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = buildAuthenticate(app.config.JWT_ACCESS_SECRET);
  const orgId = (request: { user?: { organizationId: string } }) => request.user!.organizationId;

  app.get('/locomotives/:id/maintenance-schedules', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    await assertLocomotiveOwned(id, orgId(request));
    const schedules = await prisma.maintenanceSchedule.findMany({ where: { locomotiveId: id } });
    return { data: schedules };
  });

  app.post(
    '/locomotives/:id/maintenance-schedules',
    { preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')] },
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
    { preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')] },
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
    { preHandler: [authenticate, requireRole('ADMIN')] },
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

  app.get('/locomotives/:id/cost-records', { preHandler: authenticate }, async (request) => {
    const { id } = request.params as { id: string };
    await assertLocomotiveOwned(id, orgId(request));
    const pagination = paginationSchema.parse(request.query);
    const { year, category } = request.query as { year?: string; category?: string };
    const where = {
      locomotiveId: id,
      organizationId: orgId(request),
      ...(year ? { year: Number(year) } : {}),
      ...(category ? { category: category as never } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.costRecord.findMany({ where, ...paginationArgs(pagination), orderBy: { year: 'desc' } }),
      prisma.costRecord.count({ where }),
    ]);
    return { data: items, meta: paginationMeta(pagination, total) };
  });

  app.post(
    '/locomotives/:id/cost-records',
    { preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')] },
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
