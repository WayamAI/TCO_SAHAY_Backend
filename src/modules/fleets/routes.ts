import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { buildAuthenticate, requireRole } from '../../shared/authenticate.js';
import { NotFoundError } from '../../shared/errors.js';
import { paginationArgs, paginationMeta, paginationSchema } from '../../shared/pagination.js';
import { z2j } from '../../shared/zodSchema.js';
import { bearerAuth, dataResponse, errorResponse } from '../../shared/openapiEnvelope.js';

const createSchema = z.object({ name: z.string().min(1) });
const updateSchema = z.object({ name: z.string().min(1).optional(), archived: z.boolean().optional() });
const fleetParamsSchema = z.object({ fleetId: z.string() });

// Loose object - Prisma row shape, not re-declared field-by-field here to
// avoid duplicating prisma/schema.prisma as a second source of truth.
const entitySchema = z.object({}).passthrough();

export async function fleetRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = buildAuthenticate(app.config.JWT_ACCESS_SECRET);

  app.get(
    '/fleets',
    {
      preHandler: authenticate,
      schema: {
        tags: ['fleets'],
        summary: "List the caller's fleets, paginated",
        security: bearerAuth,
        response: { 200: dataResponse({ type: 'array', items: z2j(entitySchema) }) },
      },
    },
    async (request) => {
      const pagination = paginationSchema.parse(request.query);
      const where = { organizationId: request.user!.organizationId };
      const [items, total] = await Promise.all([
        prisma.fleet.findMany({ where, ...paginationArgs(pagination), orderBy: { createdAt: 'desc' } }),
        prisma.fleet.count({ where }),
      ]);
      return { data: items, meta: paginationMeta(pagination, total) };
    },
  );

  app.post(
    '/fleets',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')],
      schema: {
        tags: ['fleets'],
        summary: 'Create a fleet',
        security: bearerAuth,
        body: z2j(createSchema),
        response: { 201: dataResponse(z2j(entitySchema)), 403: errorResponse },
      },
    },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const fleet = await prisma.fleet.create({
        data: { organizationId: request.user!.organizationId, name: body.name },
      });
      reply.status(201);
      return { data: fleet };
    },
  );

  app.get(
    '/fleets/:fleetId',
    {
      preHandler: authenticate,
      schema: {
        tags: ['fleets'],
        summary: 'Get a fleet by id',
        security: bearerAuth,
        params: z2j(fleetParamsSchema),
        response: { 200: dataResponse(z2j(entitySchema)), 404: errorResponse },
      },
    },
    async (request) => {
      const { fleetId } = request.params as { fleetId: string };
      const fleet = await prisma.fleet.findFirst({
        where: { id: fleetId, organizationId: request.user!.organizationId },
      });
      if (!fleet) throw new NotFoundError('Fleet');
      return { data: fleet };
    },
  );

  app.patch(
    '/fleets/:fleetId',
    {
      preHandler: [authenticate, requireRole('ADMIN', 'MANAGER')],
      schema: {
        tags: ['fleets'],
        summary: 'Rename or archive a fleet',
        security: bearerAuth,
        params: z2j(fleetParamsSchema),
        body: z2j(updateSchema),
        response: { 200: dataResponse(z2j(entitySchema)), 403: errorResponse, 404: errorResponse },
      },
    },
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
    {
      preHandler: [authenticate, requireRole('ADMIN')],
      schema: {
        tags: ['fleets'],
        summary: 'Archive a fleet (ADMIN only, soft delete)',
        security: bearerAuth,
        params: z2j(fleetParamsSchema),
        response: { 200: dataResponse(), 403: errorResponse, 404: errorResponse },
      },
    },
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

  app.get(
    '/operating-profiles',
    {
      preHandler: authenticate,
      schema: {
        tags: ['fleets'],
        summary: 'List global and org-custom operating profiles',
        security: bearerAuth,
        response: { 200: dataResponse({ type: 'array', items: z2j(entitySchema) }) },
      },
    },
    async (request) => {
      const profiles = await prisma.operatingProfile.findMany({
        where: { OR: [{ organizationId: null }, { organizationId: request.user!.organizationId }] },
        orderBy: { name: 'asc' },
      });
      return { data: profiles };
    },
  );
}
