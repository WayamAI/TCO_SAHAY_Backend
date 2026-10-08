import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { buildAuthenticate, requireRole } from '../../shared/authenticate.js';
import { NotFoundError } from '../../shared/errors.js';

const updateSchema = z.object({ name: z.string().min(1) });

export async function organizationRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = buildAuthenticate(app.config.JWT_ACCESS_SECRET);

  app.get('/organizations/me', { preHandler: authenticate }, async (request) => {
    const org = await prisma.organization.findUnique({ where: { id: request.user!.organizationId } });
    if (!org) throw new NotFoundError('Organization');
    return { data: org };
  });

  app.patch(
    '/organizations/me',
    { preHandler: [authenticate, requireRole('ADMIN')] },
    async (request) => {
      const body = updateSchema.parse(request.body);
      const org = await prisma.organization.update({
        where: { id: request.user!.organizationId },
        data: { name: body.name },
      });
      return { data: org };
    },
  );
}
