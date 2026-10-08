import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { buildAuthenticate, requireRole } from '../../shared/authenticate.js';
import { NotFoundError } from '../../shared/errors.js';
import { paginationArgs, paginationMeta, paginationSchema } from '../../shared/pagination.js';

const createSchema = z.object({ name: z.string().min(1) });
const updateSchema = z.object({ name: z.string().min(1).optional(), archived: z.boolean().optional() });

export async function fleetRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = buildAuthenticate(app.config.JWT_ACCESS_SECRET);

  app.get('/fleets', { preHandler: authenticate }, async (request) => {
    const pagination = paginationSchema.parse(request.query);
    const where = { organizationId: request.user!.organizationId };
    const [items, total] = await Promise.all([
      prisma.fleet.findMany({ where, ...paginationArgs(pagination), orderBy: { createdAt: 'desc' } }),
      prisma.fleet.count({ where }),
    ]);
    return { data: items, meta: paginationMeta(pagination, total) };
  });

  app.post('/fleets', { preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')] }, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const fleet = await prisma.fleet.create({
      data: { organizationId: request.user!.organizationId, name: body.name },
    });
    reply.status(201);
    return { data: fleet };
  });

  app.get('/fleets/:fleetId', { preHandler: authenticate }, async (request) => {
    const { fleetId } = request.params as { fleetId: string };
    const fleet = await prisma.fleet.findFirst({
      where: { id: fleetId, organizationId: request.user!.organizationId },
    });
    if (!fleet) throw new NotFoundError('Fleet');
    return { data: fleet };
  });

  app.patch(
    '/fleets/:fleetId',
    { preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')] },
    async (request) => {
      const { fleetId } = request.params as { fleetId: string };
      const body = updateSchema.parse(request.body);
      const existing = await prisma.fleet.findFirst({
        where: { id: fleetId, organizationId: request.user!.organizationId },
      });
      if (!existing) throw new NotFoundError('Fleet');
      const fleet = await prisma.fleet.update({
        where: { id: fleetId },
        data: { name: body.name, archivedAt: body.archived ? new Date() : undefined },
      });
      return { data: fleet };
    },
  );

  app.delete(
    '/fleets/:fleetId',
    { preHandler: [authenticate, requireRole('ADMIN')] },
    async (request) => {
      const { fleetId } = request.params as { fleetId: string };
      const existing = await prisma.fleet.findFirst({
        where: { id: fleetId, organizationId: request.user!.organizationId },
      });
      if (!existing) throw new NotFoundError('Fleet');
      await prisma.fleet.update({ where: { id: fleetId }, data: { archivedAt: new Date() } });
      return { data: { id: fleetId, archived: true } };
    },
  );

  app.get('/operating-profiles', { preHandler: authenticate }, async (request) => {
    const profiles = await prisma.operatingProfile.findMany({
      where: { OR: [{ organizationId: null }, { organizationId: request.user!.organizationId }] },
      orderBy: { name: 'asc' },
    });
    return { data: profiles };
  });
}
