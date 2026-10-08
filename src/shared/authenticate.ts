import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken, type AccessTokenPayload } from '../modules/auth/tokens.js';
import { ForbiddenError, UnauthenticatedError } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AccessTokenPayload;
  }
}

export function buildAuthenticate(jwtAccessSecret: string) {
  return async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthenticatedError();
    const token = header.slice('Bearer '.length);
    try {
      request.user = verifyAccessToken(token, jwtAccessSecret);
    } catch {
      throw new UnauthenticatedError('Invalid or expired access token');
    }
  };
}

export function requireRole(...roles: string[]) {
  return async function (request: FastifyRequest): Promise<void> {
    if (!request.user || !roles.includes(request.user.role)) {
      throw new ForbiddenError();
    }
  };
}
