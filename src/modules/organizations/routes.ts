import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import { buildAuthenticate, requireRole } from '../../shared/authenticate.js';
import { NotFoundError } from '../../shared/errors.js';
import { z2j } from '../../shared/zodSchema.js';
import { bearerAuth, dataResponse, errorResponse } from '../../shared/openapiEnvelope.js';

const updateSchema = z.object({ name: z.string().min(1) });

const organizationSchema = z.object({ id: z.string(), name: z.string() });

export async function organizationRoutes(app: FastifyInstance): Promise<void> {
  const authenticate = buildAuthenticate(app.config.JWT_ACCESS_SECRET);

  app.get(
    '/organizations/me',
    {
      preHandler: authenticate,
      schema: {
        tags: ['organizations'],
        summary: "Get the caller's organization",
        security: bearerAuth,
        response: { 200: dataResponse(z2j(organizationSchema)), 401: errorResponse },
      },
    },
    async (request) => {
      const org = await prisma.organization.findUnique({ where: { id: request.user!.organizationId } });
      if (!org) throw new NotFoundError('Organization');
      return { data: org };
    },
  );

  app.patch(
    '/organizations/me',
    {
      preHandler: [authenticate, requireRole('ADMIN')],
      schema: {
        tags: ['organizations'],
        summary: "Rename the caller's organization (ADMIN only)",
        security: bearerAuth,
        body: z2j(updateSchema),
        response: { 200: dataResponse(z2j(organizationSchema)), 403: errorResponse },
      },
    },
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
