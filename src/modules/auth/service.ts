import type { PrismaClient } from '@prisma/client';
import { ConflictError, InvalidCredentialsError, UnauthenticatedError } from '../../shared/errors.js';
import { hashPassword, verifyPassword } from './password.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  type AccessTokenPayload,
} from './tokens.js';

export interface AuthDeps {
  prisma: PrismaClient;
  jwtAccessSecret: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; organizationId: string; role: string };
}

export async function register(
  deps: AuthDeps,
  input: { organizationName: string; email: string; password: string },
): Promise<AuthResult> {
  const existing = await deps.prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError('An account with this email already exists');

  const passwordHash = await hashPassword(input.password);

  const { organization, user, membership } = await deps.prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name: input.organizationName } });
    const user = await tx.user.create({ data: { email: input.email, passwordHash } });
    const membership = await tx.membership.create({
      data: { userId: user.id, organizationId: organization.id, role: 'ADMIN' },
    });
    return { organization, user, membership };
  });

  return issueTokens(deps, { id: user.id, email: user.email, organizationId: organization.id, role: membership.role });
}

export async function login(
  deps: AuthDeps,
  input: { email: string; password: string },
): Promise<AuthResult> {
  const user = await deps.prisma.user.findUnique({
    where: { email: input.email },
    include: { memberships: true },
  });
  if (!user || user.deactivatedAt) throw new InvalidCredentialsError();

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) throw new InvalidCredentialsError();

  const membership = user.memberships[0];
  if (!membership) throw new InvalidCredentialsError();

  return issueTokens(deps, {
    id: user.id,
    email: user.email,
    organizationId: membership.organizationId,
    role: membership.role,
  });
}

export async function refresh(deps: AuthDeps, refreshToken: string): Promise<AuthResult> {
  const tokenHash = hashRefreshToken(refreshToken);
  const stored = await deps.prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new UnauthenticatedError('Refresh token is invalid or expired');
  }

  await deps.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

  const user = await deps.prisma.user.findUnique({
    where: { id: stored.userId },
    include: { memberships: true },
  });
  if (!user || user.deactivatedAt) throw new UnauthenticatedError();
  const membership = user.memberships[0];
  if (!membership) throw new UnauthenticatedError();

  return issueTokens(deps, {
    id: user.id,
    email: user.email,
    organizationId: membership.organizationId,
    role: membership.role,
  });
}

export async function logout(deps: AuthDeps, refreshToken: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);
  await deps.prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function issueTokens(
  deps: AuthDeps,
  user: { id: string; email: string; organizationId: string; role: string },
): Promise<AuthResult> {
  const payload: AccessTokenPayload = {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
  };
  const accessToken = signAccessToken(payload, deps.jwtAccessSecret);
  const { token: refreshToken, tokenHash, expiresAt } = generateRefreshToken();
  await deps.prisma.refreshToken.create({ data: { userId: user.id, tokenHash, expiresAt } });
  return { accessToken, refreshToken, user };
}
