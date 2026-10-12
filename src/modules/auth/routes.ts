import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db/client.js';
import * as authService from './service.js';
import { z2j } from '../../shared/zodSchema.js';
import { dataResponse, errorResponse } from '../../shared/openapiEnvelope.js';

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

const authResultSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({ id: z.string(), email: z.string(), organizationId: z.string(), role: z.string() }),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const jwtAccessSecret = app.config.JWT_ACCESS_SECRET;
  const deps = { prisma, jwtAccessSecret };

  app.post(
    '/auth/register',
    {
      preHandler: app.rateLimit({ max: 10, timeWindow: '1 minute' }),
      schema: {
        tags: ['auth'],
        summary: 'Register a new organization and its first ADMIN user',
        body: z2j(registerSchema),
        response: { 201: dataResponse(z2j(authResultSchema)), 409: errorResponse },
      },
    },
    async (request, reply) => {
      const body = registerSchema.parse(request.body);
      const result = await authService.register(deps, body);
      reply.status(201);
      return { data: result };
    },
  );

  app.post(
    '/auth/login',
    {
      preHandler: app.rateLimit({ max: 10, timeWindow: '1 minute' }),
      schema: {
        tags: ['auth'],
        summary: 'Log in with email and password',
        body: z2j(loginSchema),
        response: { 200: dataResponse(z2j(authResultSchema)), 401: errorResponse },
      },
    },
    async (request) => {
      const body = loginSchema.parse(request.body);
      const result = await authService.login(deps, body);
      return { data: result };
    },
  );

  app.post(
    '/auth/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Rotate a refresh token for a new access/refresh pair',
        body: z2j(refreshSchema),
        response: { 200: dataResponse(z2j(authResultSchema)), 401: errorResponse },
      },
    },
    async (request) => {
      const body = refreshSchema.parse(request.body);
      const result = await authService.refresh(deps, body.refreshToken);
      return { data: result };
    },
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke a refresh token',
        body: z2j(refreshSchema),
        response: { 200: dataResponse(z2j(z.object({ loggedOut: z.boolean() }))) },
      },
    },
    async (request) => {
      const body = refreshSchema.parse(request.body);
      await authService.logout(deps, body.refreshToken);
      return { data: { loggedOut: true } };
    },
  );
}
