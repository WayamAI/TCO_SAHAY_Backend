import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { buildAuthenticate, requireRole } from '../../shared/authenticate.js';
import { hashPassword } from '../auth/password.js';
import { ConflictError, NotFoundError } from '../../shared/errors.js';

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER']),
});

const roleSchema = z.object({ role: z.enum(['ADMIN', 'MANAGER', 'ANALYST', 'VIEWER']) });

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = buildAuthenticate(app.config.JWT_ACCESS_SECRET);

  app.get('/users', { preHandler: authenticate }, async (request) => {
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
  });

  app.post('/users', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
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
  });

  app.patch(
    '/users/:userId/role',
    { preHandler: [authenticate, requireRole('ADMIN')] },
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
    { preHandler: [authenticate, requireRole('ADMIN')] },
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
