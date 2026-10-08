// Mandatory cross-tenant isolation suite (master spec Phase 27).
// Extended, not duplicated, as each new module adds tenant-scoped endpoints.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../app/buildApp.js';
import { loadConfig } from '../app/config.js';

const prisma = new PrismaClient();
const config = loadConfig({
  ...process.env,
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

async function registerOrg(app: Awaited<ReturnType<typeof buildApp>>, suffix: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      organizationName: `Org ${suffix}`,
      email: `admin-${suffix}@example.test`,
      password: 'supersecret123',
    },
  });
  return res.json().data as { accessToken: string; user: { organizationId: string } };
}

describe('tenant isolation', () => {
  it('two organizations get distinct ids and tokens scoped to themselves', async () => {
    const app = await buildApp(config);
    const orgA = await registerOrg(app, 'a');
    const orgB = await registerOrg(app, 'b');

    expect(orgA.user.organizationId).not.toBe(orgB.user.organizationId);
    expect(orgA.accessToken).not.toBe(orgB.accessToken);
  });
});
