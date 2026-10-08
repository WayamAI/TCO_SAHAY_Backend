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
  PORT: '8094',
});

beforeEach(async () => {
  await prisma.tcoRun.deleteMany();
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

async function setupLocomotiveWithComponent(app: Awaited<ReturnType<typeof buildApp>>) {
  const register = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { organizationName: 'Acme Rail', email: 'admin@acme.test', password: 'supersecret123' },
  });
  const token = register.json().data.accessToken as string;
  const profiles = await app.inject({
    method: 'GET',
    url: '/api/v1/operating-profiles',
    headers: { authorization: `Bearer ${token}` },
  });
  const operatingProfileId = profiles.json().data[0].id;
  const fleet = await app.inject({
    method: 'POST',
    url: '/api/v1/fleets',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Main Fleet' },
  });
  const locomotiveRes = await app.inject({
    method: 'POST',
    url: '/api/v1/locomotives',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      fleetId: fleet.json().data.id,
      operatingProfileId,
      model: 'ES44AC',
      manufacturer: 'GE',
      type: 'Diesel',
      horsepower: 4400,
      purchaseCost: 2500000,
      commissionYear: 2015,
      plannedLifeYears: 30,
      annualKm: 180000,
      annualHours: 4500,
      fuelType: 'Diesel',
      fuelCostPerUnit: 0.9,
      status: 'Active',
    },
  });
  const locomotiveId = locomotiveRes.json().data.id as string;

  const system = await prisma.systemNode.create({
    data: {
      organizationId: register.json().data.user.organizationId,
      locomotiveId,
      name: 'Propulsion',
      icon: 'engine',
      criticality: 'High',
    },
  });
  const assembly = await prisma.assembly.create({
    data: { organizationId: system.organizationId, systemNodeId: system.id, name: 'Traction' },
  });
  await app.inject({
    method: 'POST',
    url: `/api/v1/locomotives/${locomotiveId}/components`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      assemblyId: assembly.id,
      name: 'Traction Motor',
      purchaseCost: 10000,
      replacementCost: 10000,
      lifeYears: 5,
      mtbfHours: 40000,
      weibullBeta: 2,
      weibullEta: 50000,
      mttrHours: 12,
      warrantyYears: 7,
      laborCostPct: 18,
      failureImpact: 'High',
      category: 'Propulsion',
      downtimeCostPerDay: 5000,
    },
  });

  return { token, locomotiveId };
}

describe('tco runs', () => {
  it('runs the TCO engine for a locomotive, persists it, and lists history', async () => {
    const app = await buildApp(config);
    const { token, locomotiveId } = await setupLocomotiveWithComponent(app);

    const runRes = await app.inject({
      method: 'POST',
      url: '/api/v1/tco/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId, horizonYears: 20 },
    });
    expect(runRes.statusCode).toBe(201);
    const run = runRes.json().data;
    expect(run.outputs.rows).toHaveLength(1);
    expect(run.outputs.totalCost).toBeGreaterThan(0);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/tco/runs/${run.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.outputs.totalCost).toBe(run.outputs.totalCost);

    const historyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/locomotives/${locomotiveId}/tco-runs`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(historyRes.json().data).toHaveLength(1);
  });
});
