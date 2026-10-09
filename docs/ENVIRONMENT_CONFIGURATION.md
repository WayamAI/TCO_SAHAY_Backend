# Phase 9 — Environment Configuration Reference

Source: `src/app/config.ts` (Zod `envSchema`, enforced at startup via `loadConfig`), `.env.example`, `src/app/buildApp.ts`.

## Required environment variables

| Variable | Validation | Default | Example (placeholder, not a real secret) |
|---|---|---|---|
| `DATABASE_URL` | non-empty string | none (required) | `postgresql://user:password@host:5432/dbname?schema=public` |
| `JWT_ACCESS_SECRET` | non-empty string | none (required) | `change-me` |
| `JWT_REFRESH_SECRET` | non-empty string | none (required) | `change-me-too` |
| `CORS_ORIGINS` | non-empty string, comma-separated origin list | none (required) | `http://localhost:3000` |
| `PORT` | coerced positive int | `8000` | `8000` |
| `NODE_ENV` | enum `development`/`test`/`production` | `development` | `development` |

All 6 are already documented with placeholder values in the repo's checked-in `.env.example` — no secrets are present there.

`loadConfig()` runs `envSchema.parse(env)` at startup and throws (fails fast) if any required var is missing or malformed — there is no silent fallback to an insecure default for secrets.

## Auth middleware

- JWT bearer tokens, verified via `buildAuthenticate(app.config.JWT_ACCESS_SECRET)` (`src/shared/authenticate.ts`), used as `preHandler` on every protected route.
- Refresh tokens handled separately in `src/modules/auth/routes.ts` (`POST /auth/refresh`), signed with `JWT_REFRESH_SECRET` — access and refresh secrets are intentionally distinct.
- RBAC via `requireRole('ADMIN' | 'MANAGER' | 'VIEWER')` preHandler, stacked after `authenticate` on role-gated routes (see `API_CONTRACT_AUDIT.md` for the per-route matrix).

## CORS

- `@fastify/cors` registered in `src/app/buildApp.ts` line 27: `app.register(cors, { origin: config.CORS_ORIGINS.split(',') })`.
- Origins are a strict allowlist derived from `CORS_ORIGINS` (comma-separated) — no wildcard `*` is used.
- Default `.env.example` value (`http://localhost:3000`) matches Next.js's default dev port, so local frontend dev should work against a locally-run backend without extra CORS config. Any other deployment target (staging/prod frontend URL) must be added to `CORS_ORIGINS` explicitly.

## DB connection handling

- Prisma Client (`src/db/client.ts`) connects via `DATABASE_URL`. No connection pooling override or retry logic was found beyond Prisma's defaults — not a gap introduced by this audit, just noted as the current state.
- Live DB check performed in this audit: `npx prisma migrate status` connected successfully to `postgresql://.../tco_backend` on `localhost:5432` and reported all 6 migrations applied, schema up to date. This confirms a working local dev DB exists in this environment; no production/staging DB was touched or assumed.

## Error serialization

- `src/app/errorHandler.ts` provides a central Fastify error handler; routes consistently use `errorResponse` schema helper from `src/shared/openapiEnvelope.ts` for documenting 400/403/404/409 responses in OpenAPI, matching actual thrown errors (`NotFoundError`, `ValidationError`, etc. from `src/shared/errors.ts`).

## API versioning

- Every module route is registered with `{ prefix: '/api/v1' }` in `src/app/buildApp.ts` (lines 34-42) — all backend endpoints live under `/api/v1/*`. `/openapi.json`, `/docs`, `/health`, `/ready` are unprefixed (framework/ops routes).
