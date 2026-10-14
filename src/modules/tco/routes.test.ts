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

  it('applies scenario assumptions to the TCO run and produces the expected result', async () => {
    const app = await buildApp(config);
    const { token, locomotiveId } = await setupLocomotiveWithComponent(app);

    // Component: lifeYears 5, warrantyYears 7, replacementCost 10000, laborCostPct 18
    // (event cost = 10000 + 1800 = 11800), weibullBeta 2, weibullEta 50000.
    //
    // Scenario doubles maintenance frequency (effective lifeYears = 5/2 = 2.5),
    // extends warranty by 3 years (7 -> 10), and doubles the failure rate.
    const scenarioRes = await app.inject({
      method: 'POST',
      url: '/api/v1/scenarios',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Doubled Maintenance + Extended Warranty',
        planningHorizonYears: 20,
        discountRate: 5,
        laborRate: 100,
        maintenanceIntervalMultiplier: 2,
        failureRateMultiplier: 2,
        warrantyExtendedYears: 3,
        fuelCostPerLiter: 1.5,
        inflationEnabled: false,
        includeDowntime: false,
      },
    });
    expect(scenarioRes.statusCode).toBe(201);
    const scenarioId = scenarioRes.json().data.id;

    const baselineRun = await app.inject({
      method: 'POST',
      url: '/api/v1/tco/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId, horizonYears: 20 },
    });
    const baseline = baselineRun.json().data.outputs;
    // Events at 5,10,15,20 -> 4 events, only year-5 under warranty (<=7).
    expect(baseline.rows[0].eventCount).toBe(4);
    expect(baseline.warrantyCoveredCost).toBe(11800);
    expect(baseline.totalCost).toBe(4 * 11800);

    const scenarioRun = await app.inject({
      method: 'POST',
      url: '/api/v1/tco/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId, scenarioId },
    });
    expect(scenarioRun.statusCode).toBe(201);
    const scenario = scenarioRun.json().data.outputs;
    const run = scenarioRun.json().data;

    // horizonYears defaulted from the scenario's planningHorizonYears (20),
    // even though the request body didn't supply one.
    expect(run.horizonYears).toBe(20);
    // Effective interval 2.5y over 20y -> events at 2.5,5,7.5,10,12.5,15,17.5,20 = 8 events.
    expect(scenario.rows[0].eventCount).toBe(8);
    // Warranty now 10y: events at 2.5,5,7.5,10 are covered = 4 of 8.
    expect(scenario.warrantyCoveredCost).toBe(4 * 11800);
    expect(scenario.totalCost).toBe(8 * 11800);
    expect(scenario.customerTCO).toBe(scenario.totalCost - scenario.warrantyCoveredCost);

    // Buffer = replacementCost * weibullFailureProbability(ageHours, beta, eta) * failureRateMultiplier.
    const ageHours = 20 * 4500;
    const weibull = 1 - Math.exp(-Math.pow(ageHours / 50000, 2));
    const expectedBuffer = 10000 * weibull * 2;
    expect(scenario.buffer).toBeCloseTo(expectedBuffer, 4);

    // The scenario-driven run must cost strictly more than the baseline run
    // (more frequent maintenance + doubled failure reserve).
    expect(scenario.totalCost).toBeGreaterThan(baseline.totalCost);
  });

  it('scenario.includeDowntime adds downtime cost to the persisted TCO run', async () => {
    const app = await buildApp(config);
    const { token, locomotiveId } = await setupLocomotiveWithComponent(app);

    // Component: mttrHours 12, downtimeCostPerDay 5000 -> downtime per event
    // = (12 / 24) * 5000 = 2500. 4 events over 20y (lifeYears 5) -> 10000 total.
    const scenarioRes = await app.inject({
      method: 'POST',
      url: '/api/v1/scenarios',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Downtime Enabled',
        planningHorizonYears: 20,
        discountRate: 5,
        laborRate: 100,
        maintenanceIntervalMultiplier: 1,
        failureRateMultiplier: 1,
        warrantyExtendedYears: 0,
        fuelCostPerLiter: 1.5,
        inflationEnabled: false,
        includeDowntime: true,
      },
    });
    const scenarioId = scenarioRes.json().data.id;

    const baselineRun = await app.inject({
      method: 'POST',
      url: '/api/v1/tco/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId, horizonYears: 20 },
    });
    const baseline = baselineRun.json().data.outputs;
    expect(baseline.downtimeCost).toBe(0);

    const scenarioRun = await app.inject({
      method: 'POST',
      url: '/api/v1/tco/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId, scenarioId },
    });
    const withDowntime = scenarioRun.json().data.outputs;
    expect(withDowntime.downtimeCost).toBe(4 * 2500);
    expect(withDowntime.totalCost).toBe(baseline.totalCost + withDowntime.downtimeCost);
  });

  it('a PATCH to an existing scenario changes the result of a subsequent TCO run using it', async () => {
    const app = await buildApp(config);
    const { token, locomotiveId } = await setupLocomotiveWithComponent(app);

    const scenarioRes = await app.inject({
      method: 'POST',
      url: '/api/v1/scenarios',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Starts Without Downtime',
        planningHorizonYears: 20,
        discountRate: 5,
        laborRate: 100,
        maintenanceIntervalMultiplier: 1,
        failureRateMultiplier: 1,
        warrantyExtendedYears: 0,
        fuelCostPerLiter: 1.5,
        inflationEnabled: false,
        includeDowntime: false,
      },
    });
    const scenarioId = scenarioRes.json().data.id;

    const beforeUpdateRun = await app.inject({
      method: 'POST',
      url: '/api/v1/tco/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId, scenarioId },
    });
    expect(beforeUpdateRun.json().data.outputs.downtimeCost).toBe(0);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/scenarios/${scenarioId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { includeDowntime: true },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().data.includeDowntime).toBe(true);

    const afterUpdateRun = await app.inject({
      method: 'POST',
      url: '/api/v1/tco/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId, scenarioId },
    });
    // Same scenario id, same locomotive -- only the PATCH changed in between.
    expect(afterUpdateRun.json().data.outputs.downtimeCost).toBe(4 * 2500);
  });

  it('rejects a scenarioId from another organization with 404', async () => {
    const app = await buildApp(config);
    const { token, locomotiveId } = await setupLocomotiveWithComponent(app);

    const otherOrg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { organizationName: 'Other Org', email: 'admin@other.test', password: 'supersecret123' },
    });
    const otherToken = otherOrg.json().data.accessToken as string;
    const otherScenario = await app.inject({
      method: 'POST',
      url: '/api/v1/scenarios',
      headers: { authorization: `Bearer ${otherToken}` },
      payload: {
        name: 'Other Org Scenario',
        planningHorizonYears: 10,
        discountRate: 5,
        laborRate: 100,
        maintenanceIntervalMultiplier: 1,
        failureRateMultiplier: 1,
        warrantyExtendedYears: 0,
        fuelCostPerLiter: 1,
        inflationEnabled: false,
        includeDowntime: false,
      },
    });
    const otherScenarioId = otherScenario.json().data.id;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tco/runs',
      headers: { authorization: `Bearer ${token}` },
      payload: { locomotiveId, scenarioId: otherScenarioId },
    });
    expect(res.statusCode).toBe(404);
  });
});
