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
  PORT: '8096',
});

beforeEach(async () => {
  await prisma.costRecord.deleteMany();
  await prisma.maintenanceSchedule.deleteMany();
  await prisma.component.deleteMany();
  await prisma.assembly.deleteMany();
  await prisma.systemNode.deleteMany();
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

describe('fleets and locomotives', () => {
  it('creates a fleet and locomotive, retrieves tree, and blocks cross-org access', async () => {
    const app = await buildApp(config);
    const tokenA = await registerAndGetToken(app, 'a');
    const tokenB = await registerAndGetToken(app, 'b');

    const profiles = await app.inject({
      method: 'GET',
      url: '/api/v1/operating-profiles',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const profileId = profiles.json().data[0].id;

    const fleetRes = await app.inject({
      method: 'POST',
      url: '/api/v1/fleets',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Main Fleet' },
    });
    expect(fleetRes.statusCode).toBe(201);
    const fleetId = fleetRes.json().data.id;

    const locoRes = await app.inject({
      method: 'POST',
      url: '/api/v1/locomotives',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        fleetId,
        operatingProfileId: profileId,
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
    expect(locoRes.statusCode).toBe(201);
    const locomotiveId = locoRes.json().data.id;

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/locomotives/${locomotiveId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.model).toBe('ES44AC');

    const crossOrgRes = await app.inject({
      method: 'GET',
      url: `/api/v1/locomotives/${locomotiveId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(crossOrgRes.statusCode).toBe(404);

    const crossOrgFleet = await app.inject({
      method: 'GET',
      url: `/api/v1/fleets/${fleetId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(crossOrgFleet.statusCode).toBe(404);
  });
});
