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
  await prisma.simulationRun.deleteMany();
  await prisma.tcoRun.deleteMany();
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

async function setupLocomotive(app: Awaited<ReturnType<typeof buildApp>>, token: string) {
  const profiles = await app.inject({
    method: 'GET',
    url: '/api/v1/operating-profiles',
    headers: { authorization: `Bearer ${token}` },
  });
  const profileId = profiles.json().data[0].id;
  const fleetRes = await app.inject({
    method: 'POST',
    url: '/api/v1/fleets',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Main Fleet' },
  });
  const fleetId = fleetRes.json().data.id;
  const locoRes = await app.inject({
    method: 'POST',
    url: '/api/v1/locomotives',
    headers: { authorization: `Bearer ${token}` },
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
  return locoRes.json().data.id as string;
}

describe('system/assembly hierarchy', () => {
  it('creates a system and an assembly under it via HTTP, buildable end to end', async () => {
    const app = await buildApp(config);
    const token = await registerAndGetToken(app, 'tree');
    const locomotiveId = await setupLocomotive(app, token);

    const systemRes = await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/systems`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Propulsion', icon: 'engine', criticality: 'High' },
    });
    expect(systemRes.statusCode).toBe(201);
    const systemId = systemRes.json().data.id;

    const assemblyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/systems/${systemId}/assemblies`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Traction' },
    });
    expect(assemblyRes.statusCode).toBe(201);
    const assemblyId = assemblyRes.json().data.id;

    // A component can now be created against this assembly through the
    // pre-existing component route, proving the tree is fully API-buildable.
    const componentRes = await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/components`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        assemblyId,
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
    expect(componentRes.statusCode).toBe(201);

    const tree = await app.inject({
      method: 'GET',
      url: `/api/v1/locomotives/${locomotiveId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(tree.json().data.systems[0].assemblies[0].components).toHaveLength(1);
  });

  it('rejects creating a system or assembly on another organization’s locomotive', async () => {
    const app = await buildApp(config);
    const tokenA = await registerAndGetToken(app, 'owner');
    const tokenB = await registerAndGetToken(app, 'intruder');
    const locomotiveId = await setupLocomotive(app, tokenA);

    const crossOrgSystem = await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/systems`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { name: 'Propulsion', icon: 'engine', criticality: 'High' },
    });
    expect(crossOrgSystem.statusCode).toBe(404);

    const ownSystem = await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/systems`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { name: 'Propulsion', icon: 'engine', criticality: 'High' },
    });
    const systemId = ownSystem.json().data.id;

    const crossOrgAssembly = await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/systems/${systemId}/assemblies`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: { name: 'Traction' },
    });
    expect(crossOrgAssembly.statusCode).toBe(404);
  });
});

describe('component RBAC', () => {
  it('rejects a VIEWER updating or deleting a component with 403, but ADMIN/MANAGER can', async () => {
    const app = await buildApp(config);
    const adminToken = await registerAndGetToken(app, 'component-rbac');
    const locomotiveId = await setupLocomotive(app, adminToken);

    const systemRes = await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/systems`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Propulsion', icon: 'engine', criticality: 'High' },
    });
    const systemId = systemRes.json().data.id;
    const assemblyRes = await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/systems/${systemId}/assemblies`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Traction' },
    });
    const assemblyId = assemblyRes.json().data.id;
    const componentRes = await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/components`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        assemblyId,
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
    const componentId = componentRes.json().data.id;

    await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: 'viewer@component-rbac.test', password: 'viewerpass123', role: 'VIEWER' },
    });
    const viewerLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'viewer@component-rbac.test', password: 'viewerpass123' },
    });
    const viewerToken = viewerLogin.json().data.accessToken;

    const viewerUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/components/${componentId}`,
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { name: 'Should Not Apply' },
    });
    expect(viewerUpdate.statusCode).toBe(403);

    const viewerDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/components/${componentId}`,
      headers: { authorization: `Bearer ${viewerToken}` },
    });
    expect(viewerDelete.statusCode).toBe(403);

    const adminUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/v1/components/${componentId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: 'Renamed Motor' },
    });
    expect(adminUpdate.statusCode).toBe(200);
    expect(adminUpdate.json().data.name).toBe('Renamed Motor');

    const adminDelete = await app.inject({
      method: 'DELETE',
      url: `/api/v1/components/${componentId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(adminDelete.statusCode).toBe(200);
    expect(adminDelete.json().data.deleted).toBe(true);
  });
});
