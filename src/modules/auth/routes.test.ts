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

describe('auth HTTP lifecycle', () => {
  it('registers, logs in, refreshes, and logs out over real HTTP requests', async () => {
    const app = await buildApp(config);

    const registerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { organizationName: 'Lifecycle Rail', email: 'lifecycle@acme.test', password: 'supersecret123' },
    });
    expect(registerRes.statusCode).toBe(201);
    const registerBody = registerRes.json();
    expect(registerBody.data.accessToken).toBeTypeOf('string');
    expect(registerBody.data.refreshToken).toBeTypeOf('string');
    expect(registerBody.data.user.email).toBe('lifecycle@acme.test');
    expect(registerBody.data.user.role).toBe('ADMIN');

    const duplicateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { organizationName: 'Another Org', email: 'lifecycle@acme.test', password: 'supersecret123' },
    });
    expect(duplicateRes.statusCode).toBe(409);

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'lifecycle@acme.test', password: 'supersecret123' },
    });
    expect(loginRes.statusCode).toBe(200);
    const loginBody = loginRes.json();
    expect(loginBody.data.accessToken).toBeTypeOf('string');

    const badLoginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'lifecycle@acme.test', password: 'wrong-password' },
    });
    expect(badLoginRes.statusCode).toBe(401);

    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: loginBody.data.refreshToken },
    });
    expect(refreshRes.statusCode).toBe(200);
    const refreshBody = refreshRes.json();
    expect(refreshBody.data.accessToken).toBeTypeOf('string');
    expect(refreshBody.data.refreshToken).toBeTypeOf('string');

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      payload: { refreshToken: refreshBody.data.refreshToken },
    });
    expect(logoutRes.statusCode).toBe(200);
    expect(logoutRes.json().data.loggedOut).toBe(true);

    const reuseRefreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: refreshBody.data.refreshToken },
    });
    expect(reuseRefreshRes.statusCode).toBe(401);
  });

  it('rejects a refresh with an invalid or already-rotated token with 401', async () => {
    const app = await buildApp(config);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: 'not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });
});
