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
  PORT: '8091',
});

beforeEach(async () => {
  await prisma.tcoRun.deleteMany();
  await prisma.scenario.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const scenarioPayload = {
  name: 'Worst Case',
  planningHorizonYears: 20,
  discountRate: 5,
  laborRate: 130,
  maintenanceIntervalMultiplier: 0.8,
  failureRateMultiplier: 2.0,
  warrantyExtendedYears: 0,
  fuelCostPerLiter: 2.1,
  inflationEnabled: true,
  includeDowntime: true,
};

async function registerAndGetToken(app: Awaited<ReturnType<typeof buildApp>>, suffix: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { organizationName: `Org ${suffix}`, email: `admin-${suffix}@test.local`, password: 'supersecret123' },
  });
  return res.json().data.accessToken as string;
}

describe('scenarios', () => {
  it('supports full CRUD and role enforcement', async () => {
    const app = await buildApp(config);
    const token = await registerAndGetToken(app, 'crud');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/scenarios',
      headers: { authorization: `Bearer ${token}` },
      payload: scenarioPayload,
    });
    expect(createRes.statusCode).toBe(201);
    const scenarioId = createRes.json().data.id;

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/scenarios',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.json().data).toHaveLength(1);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/scenarios/${scenarioId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.json().data.name).toBe('Worst Case');

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/scenarios/${scenarioId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Worst Case Revised' },
    });
    expect(patchRes.json().data.name).toBe('Worst Case Revised');

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/scenarios/${scenarioId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteRes.statusCode).toBe(200);

    const afterDelete = await app.inject({
      method: 'GET',
      url: `/api/v1/scenarios/${scenarioId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterDelete.statusCode).toBe(404);
  });

  it('enforces tenant isolation: Org A cannot read or write Org B scenarios', async () => {
    const app = await buildApp(config);
    const tokenA = await registerAndGetToken(app, 'a');
    const tokenB = await registerAndGetToken(app, 'b');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/scenarios',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: scenarioPayload,
    });
    const scenarioId = created.json().data.id;

    const crossRead = await app.inject({
      method: 'GET',
      url: `/api/v1/scenarios/${scenarioId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(crossRead.statusCode).toBe(404);

    const crossWrite = await app.inject({
      method: 'PATCH',
      url: `/api/v1/scenarios/${scenarioId}`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { name: 'Hijacked' },
    });
    expect(crossWrite.statusCode).toBe(404);

    const crossDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/scenarios/${scenarioId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(crossDelete.statusCode).toBe(404);

    const crossList = await app.inject({
      method: 'GET',
      url: '/api/v1/scenarios',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(crossList.json().data).toHaveLength(0);
  });
});
