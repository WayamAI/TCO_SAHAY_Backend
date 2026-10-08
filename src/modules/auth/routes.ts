import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import * as authService from './service.js';

const registerSchema = z.object({
  organizationName: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const jwtAccessSecret = app.config.JWT_ACCESS_SECRET;
  const deps = { prisma, jwtAccessSecret };

  app.post('/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const result = await authService.register(deps, body);
    reply.status(201);
    return { data: result };
  });

  app.post('/auth/login', async (request) => {
    const body = loginSchema.parse(request.body);
    const result = await authService.login(deps, body);
    return { data: result };
  });

  app.post('/auth/refresh', async (request) => {
    const body = refreshSchema.parse(request.body);
    const result = await authService.refresh(deps, body.refreshToken);
    return { data: result };
  });

  app.post('/auth/logout', async (request) => {
    const body = refreshSchema.parse(request.body);
    await authService.logout(deps, body.refreshToken);
    return { data: { loggedOut: true } };
  });
}
