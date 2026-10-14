import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../../app/buildApp.js';
import { loadConfig } from '../../app/config.js';

const prisma = new PrismaClient();
const config = loadConfig({
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_ACCESS_SECRET: 'test-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  CORS_ORIGINS: 'http://localhost:3000',
  PORT: '8097',
});

beforeEach(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('organizations/users routes', () => {
  it('admin can view org, list/add members, and a VIEWER cannot add members', async () => {
    const app = await buildApp(config);
    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { organizationName: 'Acme Rail', email: 'admin@acme.test', password: 'supersecret123' },
    });
    const { accessToken } = register.json().data;

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.name).toBe('Acme Rail');

    const addUser = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { email: 'viewer@acme.test', password: 'viewerpass123', role: 'VIEWER' },
    });
    expect(addUser.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(list.json().data).toHaveLength(2);

    const viewerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'viewer@acme.test', password: 'viewerpass123' },
    });
    const viewerToken = viewerLogin.json().data.accessToken;

    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { email: 'another@acme.test', password: 'anotherpass123', role: 'VIEWER' },
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('ADMIN can change a member role; VIEWER is forbidden', async () => {
    const app = await buildApp(config);
    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { organizationName: 'Role Change Rail', email: 'admin2@acme.test', password: 'supersecret123' },
    });
    const { accessToken } = register.json().data;

    const addUser = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { email: 'analyst@acme.test', password: 'analystpass123', role: 'ANALYST' },
    });
    const targetUserId = addUser.json().data.id;

    const promote = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${targetUserId}/role`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { role: 'MANAGER' },
    });
    expect(promote.statusCode).toBe(200);
    expect(promote.json().data.role).toBe('MANAGER');

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const targetMember = list.json().data.find((m: { id: string }) => m.id === targetUserId);
    expect(targetMember.role).toBe('MANAGER');

    const viewerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'analyst@acme.test', password: 'analystpass123' },
    });
    const viewerToken = viewerLogin.json().data.accessToken;

    const forbidden = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${targetUserId}/role`,
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { role: 'ADMIN' },
    });
    expect(forbidden.statusCode).toBe(403);

    const notFound = await app.inject({
      method: 'PATCH',
      url: '/api/v1/users/does-not-exist/role',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { role: 'MANAGER' },
    });
    expect(notFound.statusCode).toBe(404);
  });

  it('ADMIN can deactivate a member (soft delete); VIEWER is forbidden', async () => {
    const app = await buildApp(config);
    const register = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { organizationName: 'Deactivate Rail', email: 'admin3@acme.test', password: 'supersecret123' },
    });
    const { accessToken } = register.json().data;

    const addUser = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { email: 'tobedeactivated@acme.test', password: 'deactivatepass123', role: 'VIEWER' },
    });
    const targetUserId = addUser.json().data.id;

    const viewerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'tobedeactivated@acme.test', password: 'deactivatepass123' },
    });
    const viewerToken = viewerLogin.json().data.accessToken;

    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${targetUserId}`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(forbidden.statusCode).toBe(403);

    const deactivate = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/${targetUserId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(deactivate.statusCode).toBe(200);
    expect(deactivate.json().data.deactivated).toBe(true);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const targetMember = list.json().data.find((m: { id: string }) => m.id === targetUserId);
    expect(targetMember.deactivatedAt).not.toBeNull();

    const notFound = await app.inject({
      method: 'DELETE',
      url: '/api/v1/users/does-not-exist',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(notFound.statusCode).toBe(404);
  });
});
