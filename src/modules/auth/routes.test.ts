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
  PORT: '8097',
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

describe('auth rate limiting', () => {
  it('throttles repeated login attempts from the same client with 429', async () => {
    const app = await buildApp(config);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { organizationName: 'Acme Rail', email: 'admin@acme.test', password: 'supersecret123' },
    });

    const attempts = [];
    for (let i = 0; i < 12; i++) {
      attempts.push(
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          payload: { email: 'admin@acme.test', password: 'wrong-password' },
        }),
      );
    }

    const statusCodes = attempts.map((r) => r.statusCode);
    expect(statusCodes).toContain(401); // genuine bad-credential attempts still get through at first
    expect(statusCodes).toContain(429); // and eventually get throttled
  });

  it('throttles repeated registration attempts from the same client with 429', async () => {
    const app = await buildApp(config);

    const attempts = [];
    for (let i = 0; i < 12; i++) {
      attempts.push(
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: { organizationName: `Org ${i}`, email: `user${i}@test.local`, password: 'supersecret123' },
        }),
      );
    }

    const statusCodes = attempts.map((r) => r.statusCode);
    expect(statusCodes).toContain(429);
  });
});
