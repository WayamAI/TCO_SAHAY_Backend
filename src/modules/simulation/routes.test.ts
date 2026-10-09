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

async function setupLocomotiveWithComponent(app: Awaited<ReturnType<typeof buildApp>>, orgSuffix = 'sim') {
  const register = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { organizationName: `Acme Rail ${orgSuffix}`, email: `admin-${orgSuffix}@acme.test`, password: 'supersecret123' },
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

describe('simulation runs', () => {
  it('runs a simulation, persists it, retrieves it, and lists history', async () => {
    const app = await buildApp(config);
    const { token, locomotiveId } = await setupLocomotiveWithComponent(app);

    const runRes = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation-runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId, horizonYears: 20, iterations: 200, seed: 'fixed-seed' },
    });
    expect(runRes.statusCode).toBe(201);
    const run = runRes.json().data;

    // Response schema must not silently strip fields (Phase 7's documented bug class).
    expect(run.id).toBeDefined();
    expect(run.seed).toBe('fixed-seed');
    expect(run.iterations).toBe(200);
    expect(run.engineVersion).toBe('1.0.0');
    expect(run.summary.mean).toBeGreaterThan(0);
    expect(run.percentiles.p50).toBeGreaterThan(0);
    expect(run.histogram.length).toBeGreaterThan(0);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/simulation-runs/${run.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().data.summary.mean).toBe(run.summary.mean);

    const historyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/locomotives/${locomotiveId}/simulation-runs`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(historyRes.json().data).toHaveLength(1);
  });

  it('is reproducible for the same seed and iterations', async () => {
    const app = await buildApp(config);
    const { token, locomotiveId } = await setupLocomotiveWithComponent(app);
    const payload = { locomotiveId, horizonYears: 20, iterations: 200, seed: 'same-seed' };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation-runs',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation-runs',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    expect(first.json().data.summary).toEqual(second.json().data.summary);
    expect(first.json().data.percentiles).toEqual(second.json().data.percentiles);
  });

  it('generates a seed when none is supplied, and different runs get different seeds', async () => {
    const app = await buildApp(config);
    const { token, locomotiveId } = await setupLocomotiveWithComponent(app);

    const a = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation-runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId, horizonYears: 20, iterations: 100 },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation-runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId, horizonYears: 20, iterations: 100 },
    });
    expect(a.json().data.seed).toBeTruthy();
    expect(a.json().data.seed).not.toBe(b.json().data.seed);
  });

  it('defaults iterations and rejects out-of-range iteration counts', async () => {
    const app = await buildApp(config);
    const { token, locomotiveId } = await setupLocomotiveWithComponent(app);

    const defaulted = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation-runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId, horizonYears: 20 },
    });
    expect(defaulted.statusCode).toBe(201);
    expect(defaulted.json().data.iterations).toBe(1000);

    const tooFew = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation-runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId, horizonYears: 20, iterations: 1 },
    });
    expect(tooFew.statusCode).toBe(400);

    const tooMany = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation-runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId, horizonYears: 20, iterations: 1000000 },
    });
    expect(tooMany.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const app = await buildApp(config);
    const res = await app.inject({ method: 'POST', url: '/api/v1/simulation-runs', payload: { locomotiveId: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('enforces tenant isolation at the service/DB boundary: Org B cannot read Org A runs or list them', async () => {
    const app = await buildApp(config);
    const { token: tokenA, locomotiveId } = await setupLocomotiveWithComponent(app, 'a');
    const runRes = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation-runs',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { locomotiveId, horizonYears: 20, iterations: 100 },
    });
    const runId = runRes.json().data.id;

    const { token: tokenB } = await setupLocomotiveWithComponent(app, 'b');

    const crossRead = await app.inject({
      method: 'GET',
      url: `/api/v1/simulation-runs/${runId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(crossRead.statusCode).toBe(404);

    // Service-level check too, bypassing the HTTP layer entirely.
    const simulationService = await import('./service.js');
    await expect(
      simulationService.getSimulationRun(prisma, 'org-that-does-not-own-it', runId),
    ).rejects.toThrow();

    const crossHistory = await app.inject({
      method: 'GET',
      url: `/api/v1/locomotives/${locomotiveId}/simulation-runs`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    // Org B doesn't own locomotiveId either, so the locomotive lookup itself 404s.
    expect(crossHistory.statusCode).toBe(404);
  });

  it('rejects an unknown locomotiveId with 404', async () => {
    const app = await buildApp(config);
    const { token } = await setupLocomotiveWithComponent(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/simulation-runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId: 'does-not-exist', horizonYears: 20 },
    });
    expect(res.statusCode).toBe(404);
  });
});
