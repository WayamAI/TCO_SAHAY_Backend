import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as authService from './service.js';

const prisma = new PrismaClient();
const deps = { prisma, jwtAccessSecret: 'test-secret' };

beforeEach(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('auth service', () => {
  it('registers a new org + admin user and issues tokens', async () => {
    const result = await authService.register(deps, {
      organizationName: 'Acme Rail',
      email: 'admin@acme.test',
      password: 'supersecret123',
    });
    expect(result.user.role).toBe('ADMIN');
    expect(result.accessToken).toBeTypeOf('string');
    expect(result.refreshToken).toBeTypeOf('string');
  });

  it('rejects duplicate email registration', async () => {
    await authService.register(deps, {
      organizationName: 'Acme Rail',
      email: 'dup@acme.test',
      password: 'supersecret123',
    });
    await expect(
      authService.register(deps, {
        organizationName: 'Other Org',
        email: 'dup@acme.test',
        password: 'anotherpass123',
      }),
    ).rejects.toThrow('already exists');
  });

  it('logs in with correct credentials and rejects wrong password', async () => {
    await authService.register(deps, {
      organizationName: 'Acme Rail',
      email: 'login@acme.test',
      password: 'correct-password',
    });
    const result = await authService.login(deps, {
      email: 'login@acme.test',
      password: 'correct-password',
    });
    expect(result.user.email).toBe('login@acme.test');

    await expect(
      authService.login(deps, { email: 'login@acme.test', password: 'wrong-password' }),
    ).rejects.toThrow('Invalid email or password');
  });

  it('refresh rotates the token and rejects reuse of the old one', async () => {
    const { refreshToken } = await authService.register(deps, {
      organizationName: 'Acme Rail',
      email: 'refresh@acme.test',
      password: 'supersecret123',
    });
    const rotated = await authService.refresh(deps, refreshToken);
    expect(rotated.refreshToken).not.toBe(refreshToken);

    await expect(authService.refresh(deps, refreshToken)).rejects.toThrow();
  });

  it('logout revokes the refresh token', async () => {
    const { refreshToken } = await authService.register(deps, {
      organizationName: 'Acme Rail',
      email: 'logout@acme.test',
      password: 'supersecret123',
    });
    await authService.logout(deps, refreshToken);
    await expect(authService.refresh(deps, refreshToken)).rejects.toThrow();
  });
});
