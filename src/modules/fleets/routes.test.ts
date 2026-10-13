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
  PORT: '8099',
});

beforeEach(async () => {
  await prisma.simulationRun.deleteMany();
  await prisma.tcoRun.deleteMany();
  await prisma.scenario.deleteMany();
  await prisma.component.deleteMany();
  await prisma.assembly.deleteMany();
  await prisma.systemNode.deleteMany();
  await prisma.costRecord.deleteMany();
  await prisma.maintenanceSchedule.deleteMany();
  await prisma.locomotive.deleteMany();
  await prisma.fleet.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function registerAndGetToken(app: Awaited<ReturnType<typeof buildApp>>, suffix: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { organizationName: `Org ${suffix}`, email: `admin-${suffix}@test.local`, password: 'supersecret123' },
  });
  return res.json().data.accessToken as string;
}

describe('fleets', () => {
  it('creates, lists, retrieves, renames, and archives a fleet', async () => {
    const app = await buildApp(config);
    const token = await registerAndGetToken(app, 'fleet-a');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/fleets',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Main Fleet' },
    });
    expect(createRes.statusCode).toBe(201);
    const fleetId = createRes.json().data.id;

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/fleets',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.json().data).toHaveLength(1);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/fleets/${fleetId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.json().data.name).toBe('Main Fleet');

    const renameRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/fleets/${fleetId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Renamed Fleet' },
    });
    expect(renameRes.json().data.name).toBe('Renamed Fleet');

    const archiveRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/fleets/${fleetId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(archiveRes.statusCode).toBe(200);
    expect(archiveRes.json().data.archived).toBe(true);
  });

  it('un-archives a fleet via PATCH { archived: false }', async () => {
    const app = await buildApp(config);
    const token = await registerAndGetToken(app, 'fleet-unarchive');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/fleets',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Fleet To Unarchive' },
    });
    const fleetId = createRes.json().data.id;

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/fleets/${fleetId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    const unarchiveRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/fleets/${fleetId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { archived: false },
    });
    expect(unarchiveRes.json().data.archivedAt).toBeNull();

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/fleets/${fleetId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.json().data.archivedAt).toBeNull();
  });

  it('rejects cross-organization read, update, and delete with 404', async () => {
    const app = await buildApp(config);
    const tokenA = await registerAndGetToken(app, 'owner');
    const tokenB = await registerAndGetToken(app, 'intruder');

    const fleetRes = await app.inject({
      method: 'POST',
      url: '/api/v1/fleets',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Owner Fleet' },
    });
    const fleetId = fleetRes.json().data.id;

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/fleets/${fleetId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getRes.statusCode).toBe(404);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/fleets/${fleetId}`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { name: 'Hijacked' },
    });
    expect(patchRes.statusCode).toBe(404);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/fleets/${fleetId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(deleteRes.statusCode).toBe(404);

    // B's own fleet list must never contain A's fleet.
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/fleets',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listRes.json().data).toHaveLength(0);
  });

  it('lists global and org-custom operating profiles, scoped to the caller', async () => {
    const app = await buildApp(config);
    const token = await registerAndGetToken(app, 'profiles');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/operating-profiles',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(0);
  });
});
