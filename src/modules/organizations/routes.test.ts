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
  PORT: '8098',
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

async function registerAdmin(app: Awaited<ReturnType<typeof buildApp>>, suffix: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { organizationName: `Org ${suffix}`, email: `admin-${suffix}@test.local`, password: 'supersecret123' },
  });
  return { token: res.json().data.accessToken as string, organizationId: res.json().data.user.organizationId as string };
}

describe('organizations', () => {
  it("returns the caller's own organization", async () => {
    const app = await buildApp(config);
    const { token, organizationId } = await registerAdmin(app, 'a');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(organizationId);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const app = await buildApp(config);
    const res = await app.inject({ method: 'GET', url: '/api/v1/organizations/me' });
    expect(res.statusCode).toBe(401);
  });

  it('lets an ADMIN rename the organization', async () => {
    const app = await buildApp(config);
    const { token } = await registerAdmin(app, 'b');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organizations/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Renamed Org' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.name).toBe('Renamed Org');
  });

  it('rejects a non-ADMIN rename attempt with 403', async () => {
    const app = await buildApp(config);
    const { token: adminToken } = await registerAdmin(app, 'c');

    const inviteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: 'viewer-c@test.local', password: 'supersecret123', role: 'VIEWER' },
    });
    expect(inviteRes.statusCode).toBe(201);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'viewer-c@test.local', password: 'supersecret123' },
    });
    const viewerToken = loginRes.json().data.accessToken as string;

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/organizations/me',
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { name: 'Should Not Apply' },
    });
    expect(res.statusCode).toBe(403);
  });

  it("renaming caller A's organization never affects organization B", async () => {
    const app = await buildApp(config);
    const { token: tokenA } = await registerAdmin(app, 'd1');
    const { token: tokenB, organizationId: orgIdB } = await registerAdmin(app, 'd2');

    await app.inject({
      method: 'PATCH',
      url: '/api/v1/organizations/me',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Org A Renamed' },
    });

    const bRes = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/me',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(bRes.json().data.id).toBe(orgIdB);
    expect(bRes.json().data.name).not.toBe('Org A Renamed');
  });
});
