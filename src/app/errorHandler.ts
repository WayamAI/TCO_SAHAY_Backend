import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors.js';

export function errorHandler(
  error: FastifyError | AppError | ZodError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AppError) {
    reply.status(error.httpStatus).send({
      error: { code: error.code, message: error.message, details: error.details ?? {} },
    });
    return;
  }

  if (error instanceof ZodError) {
    reply.status(400).send({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.flatten() },
    });
    return;
  }

  // Trusted Fastify plugins (e.g. @fastify/rate-limit's 429) set their own
  // statusCode and a safe, non-sensitive message - pass those through
  // instead of flattening every 4xx into a generic 500.
  const statusCode = (error as FastifyError).statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    reply.status(statusCode).send({
      error: { code: (error as FastifyError).code ?? 'REQUEST_ERROR', message: error.message, details: {} },
    });
    return;
  }

  request.log.error({ err: error }, 'unhandled error');
  reply.status(500).send({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error', details: {} },
  });
}
