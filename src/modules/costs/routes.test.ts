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
  PORT: '8095',
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

async function setup(app: Awaited<ReturnType<typeof buildApp>>) {
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
  const locomotive = await app.inject({
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
  return { token, locomotiveId: locomotive.json().data.id as string };
}

describe('cost domain', () => {
  it('creates a maintenance schedule and cost records, and lists them filtered', async () => {
    const app = await buildApp(config);
    const { token, locomotiveId } = await setup(app);

    const scheduleRes = await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/maintenance-schedules`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Annual Inspection',
        triggerMonths: 12,
        rule: 'whichever-first',
        laborHours: 8,
        laborRatePerHour: 65,
        partsEstimate: 1200,
        type: 'PREVENTIVE',
      },
    });
    expect(scheduleRes.statusCode).toBe(201);

    await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/cost-records`,
      headers: { authorization: `Bearer ${token}` },
      payload: { year: 2024, category: 'MAINTENANCE', amount: 15000 },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/cost-records`,
      headers: { authorization: `Bearer ${token}` },
      payload: { year: 2024, category: 'FUEL', amount: 42000 },
    });

    const filtered = await app.inject({
      method: 'GET',
      url: `/api/v1/locomotives/${locomotiveId}/cost-records?category=FUEL`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(filtered.json().data).toHaveLength(1);
    expect(filtered.json().data[0].amount).toBe(42000);

    const all = await app.inject({
      method: 'GET',
      url: `/api/v1/locomotives/${locomotiveId}/cost-records`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(all.json().meta.total).toBe(2);
  });

  it('rejects an invalid cost-record category filter with 400', async () => {
    const app = await buildApp(config);
    const { token, locomotiveId } = await setup(app);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/locomotives/${locomotiveId}/cost-records?category=NOT_A_CATEGORY`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects cross-org maintenance schedule and cost record access with 404', async () => {
    const app = await buildApp(config);
    const { locomotiveId } = await setup(app);

    const otherOrg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { organizationName: 'Other Org', email: 'admin@other.test', password: 'supersecret123' },
    });
    const otherToken = otherOrg.json().data.accessToken as string;

    const scheduleRes = await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/maintenance-schedules`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: {
        name: 'Hijacked Schedule',
        triggerMonths: 12,
        rule: 'whichever-first',
        laborHours: 8,
        laborRatePerHour: 65,
        partsEstimate: 1200,
        type: 'PREVENTIVE',
      },
    });
    expect(scheduleRes.statusCode).toBe(404);

    const scheduleListRes = await app.inject({
      method: 'GET',
      url: `/api/v1/locomotives/${locomotiveId}/maintenance-schedules`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(scheduleListRes.statusCode).toBe(404);

    const costCreateRes = await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/cost-records`,
      headers: { authorization: `Bearer ${otherToken}` },
      payload: { year: 2024, category: 'FUEL', amount: 1 },
    });
    expect(costCreateRes.statusCode).toBe(404);

    const costListRes = await app.inject({
      method: 'GET',
      url: `/api/v1/locomotives/${locomotiveId}/cost-records`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(costListRes.statusCode).toBe(404);
  });

  it('maintenance schedules support update and hard delete; cost records are append-only (no mutation routes exist)', async () => {
    const app = await buildApp(config);
    const { token, locomotiveId } = await setup(app);

    const scheduleRes = await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/maintenance-schedules`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Annual Inspection',
        triggerMonths: 12,
        rule: 'whichever-first',
        laborHours: 8,
        laborRatePerHour: 65,
        partsEstimate: 1200,
        type: 'PREVENTIVE',
      },
    });
    const scheduleId = scheduleRes.json().data.id as string;

    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/maintenance-schedules/${scheduleId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { laborHours: 10, partsEstimate: 1500 },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().data.laborHours).toBe(10);
    expect(updateRes.json().data.partsEstimate).toBe(1500);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/maintenance-schedules/${scheduleId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().data.deleted).toBe(true);

    const afterDelete = await prisma.maintenanceSchedule.findUnique({ where: { id: scheduleId } });
    expect(afterDelete).toBeNull(); // hard delete, not soft

    const deleteAgainRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/maintenance-schedules/${scheduleId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteAgainRes.statusCode).toBe(404);

    const costRecordRes = await app.inject({
      method: 'POST',
      url: `/api/v1/locomotives/${locomotiveId}/cost-records`,
      headers: { authorization: `Bearer ${token}` },
      payload: { year: 2024, category: 'MAINTENANCE', amount: 15000 },
    });
    const costRecordId = costRecordRes.json().data.id as string;

    // No PATCH/DELETE route exists for cost records - corrections are new rows, not edits.
    const patchAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/v1/cost-records/${costRecordId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amount: 1 },
    });
    expect(patchAttempt.statusCode).toBe(404);

    const deleteAttempt = await app.inject({
      method: 'DELETE',
      url: `/api/v1/cost-records/${costRecordId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteAttempt.statusCode).toBe(404);

    const stillThere = await prisma.costRecord.findUnique({ where: { id: costRecordId } });
    expect(stillThere).not.toBeNull();
  });
});
