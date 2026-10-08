import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { buildAuthenticate, requireRole } from '../../shared/authenticate.js';
import { hashPassword } from '../auth/password.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';
import { z2j } from '../../shared/zodSchema.js';
import { bearerAuth, dataResponse, errorResponse } from '../../shared/openapiEnvelope.js';

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER']),
});

const roleSchema = z.object({ role: z.enum(['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER']) });

const userParamsSchema = z.object({ userId: z.string() });

const memberSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  deactivatedAt: z.string().nullable().optional(),
});

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = buildAuthenticate(app.config.JWT_ACCESS_SECRET);

  app.get(
    '/users',
    {
      preHandler: authenticate,
      schema: {
        tags: ['users'],
        summary: "List the caller's organization members",
        security: bearerAuth,
        response: { 200: dataResponse({ type: 'array', items: z2j(memberSchema) }) },
      },
    },
    async (request) => {
      const memberships = await prisma.membership.findMany({
        where: { organizationId: request.user!.organizationId },
        include: { user: true },
      });
      const data = memberships.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        role: m.role,
        deactivatedAt: m.user.deactivatedAt,
      }));
      return { data };
    },
  );

  app.post(
    '/users',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
      schema: {
        tags: ['users'],
        summary: 'Invite a new member into the organization (ADMIN only)',
        security: bearerAuth,
        body: z2j(createSchema),
        response: { 201: dataResponse(z2j(memberSchema)), 403: errorResponse, 409: errorResponse },
      },
    },
    async (request, reply) => {
      const body = createSchema.parse(request.body);
      const existing = await prisma.user.findUnique({ where: { email: body.email } });
      if (existing) throw new ConflictError('An account with this email already exists');

      const passwordHash = await hashPassword(body.password);
      const { user, membership } = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email: body.email, passwordHash } });
        const membership = await tx.membership.create({
          data: { userId: user.id, organizationId: request.user!.organizationId, role: body.role },
        });
        return { user, membership };
      });
      reply.status(201);
      return { data: { id: user.id, email: user.email, role: membership.role } };
    },
  );

  app.patch(
    '/users/:userId/role',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
      schema: {
        tags: ['users'],
        summary: "Change a member's role (ADMIN only)",
        security: bearerAuth,
        params: z2j(userParamsSchema),
        body: z2j(roleSchema),
        response: { 200: dataResponse(), 403: errorResponse, 404: errorResponse },
      },
    },
    async (request) => {
      const { userId } = request.params as { userId: string };
      const body = roleSchema.parse(request.body);
      const membership = await prisma.membership.findUnique({
        where: { userId_organizationId: { userId, organizationId: request.user!.organizationId } },
      });
      if (!membership) throw new NotFoundError('User');
      const updated = await prisma.membership.update({
        where: { id: membership.id },
        data: { role: body.role },
      });
      return { data: { id: userId, role: updated.role } };
    },
  );

  app.delete(
    '/users/:userId',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
      schema: {
        tags: ['users'],
        summary: 'Deactivate a member (ADMIN only, soft delete)',
        security: bearerAuth,
        params: z2j(userParamsSchema),
        response: { 200: dataResponse(), 403: errorResponse, 404: errorResponse },
      },
    },
    async (request) => {
      const { userId } = request.params as { userId: string };
      const membership = await prisma.membership.findUnique({
        where: { userId_organizationId: { userId, organizationId: request.user!.organizationId } },
      });
      if (!membership) throw new NotFoundError('User');
      await prisma.user.update({ where: { id: userId }, data: { deactivatedAt: new Date() } });
      return { data: { id: userId, deactivated: true } };
    },
  );
}
