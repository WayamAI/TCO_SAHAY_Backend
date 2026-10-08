# Architecture

## Module layout

```
src/
├── app/            # Fastify instance bootstrap, plugin registration,
│                   #   config loader (env parsing + validation),
│                   #   global error handler, request-id/logging plugin
├── modules/
│   ├── health/     # Phase 2
│   ├── auth/       # Phase 3
│   ├── organizations/ # Phase 3
│   ├── users/      # Phase 3
│   ├── fleets/     # Phase 4
│   ├── assets/     # Phase 4 - Locomotive/SystemNode/Assembly/Component
│   ├── costs/      # Phase 5 - MaintenanceSchedule/CostRecord
│   └── tco/        # Phase 6 - engine.ts (pure) + route + TcoRun persistence
├── db/             # prisma/schema.prisma, generated client wrapper, seed.ts
├── shared/         # error types, zod helpers, pagination helpers,
│                   #   tenantScope/authenticate/requireRole middleware
└── tests/          # integration/API-level tests spanning modules
                     #   (unit tests live next to their module as *.test.ts)
```

Each module under `modules/*` is: `routes.ts` (Fastify route registration +
Zod schemas), `service.ts` (business logic, calls Prisma), and
`*.test.ts` (unit + integration). No module exists until its phase starts —
no empty placeholder folders for `scenarios/`, `parts/`, etc.

## Request lifecycle

1. Fastify parses JSON body, applies the route's Zod request schema (400 on
   failure, mapped to `VALIDATION_ERROR`).
2. `authenticate` plugin verifies the JWT, attaches `request.user` (id, email,
   organizationId, role) — skipped for `/health`, `/ready`, `/auth/*`.
3. `requireRole(...)` (where a route needs it) checks `request.user.role`.
4. `tenantScope` injects `organizationId: request.user.organizationId` into
   every Prisma `where` clause the service builds — services never accept a
   raw `organizationId` from the request body/query, always from the
   authenticated context.
5. Service method runs, returns a plain object; route wraps it in the
   `{data, meta}` envelope.
6. Global error handler catches thrown `AppError` subclasses (each carrying a
   `code`/`httpStatus`) and anything else becomes a logged `INTERNAL_ERROR`
   with no stack trace in the response body.

## Error envelope

See `API_CONTRACT.md` for the shape and the shared error-code list. Defined
once in `shared/errors.ts` as a small `AppError` class hierarchy
(`ValidationError`, `NotFoundError`, `ConflictError`, `ForbiddenError`,
`UnauthenticatedError`) — not a generic catch-all, so each failure mode maps
to exactly one HTTP status and code.

## Database

Prisma + PostgreSQL. One `schema.prisma`, migrations committed under
`db/migrations/`. Every tenant-owned table: UUID `id` (default
`gen_random_uuid()`), `organizationId` with an index, `createdAt`/`updatedAt`
(`@default(now())` / `@updatedAt`). Soft delete (`deletedAt`) only where
history must survive a delete (Locomotive, Component) — `CostRecord`/`TcoRun`
are append-only and never deleted at all.

## Testing

Vitest. Unit tests for pure logic (TCO engine math, validation schemas) run
with no DB. Integration tests spin up against a real Postgres (via
`DATABASE_URL` pointed at a test database, reset between test files) —
no mocked ORM layer, per the spec's "no fake backend" rule. The mandatory
cross-tenant isolation test lives in `tests/tenant-isolation.test.ts` and is
extended (not duplicated) as each new module adds endpoints.

## Deployment shape (local dev, Phase 2 target)

```
Terminal 1: frontend (locomotive_wabtec-main)  → http://localhost:3000
Terminal 2: backend (this repo)                 → http://localhost:8000
Terminal 3: postgres                             → localhost:5432
```

Backend API under `http://localhost:8000/api/v1`, health at
`http://localhost:8000/health`. Frontend integration (pointing it at this
API) is explicitly out of scope until the later "frontend migration" phases —
Phases 0–6 build the backend in isolation without touching the frontend repo.
