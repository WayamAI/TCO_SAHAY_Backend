# TCO Backend

Backend for SAHAY, the locomotive fleet TCO (total cost of ownership)
intelligence platform. Frontend lives in a separate repository
(`locomotive_wabtec-main`); see `docs/FRONTEND_DOMAIN_INVENTORY.md` for how
its data/calculations map to this backend.

## Stack

Node.js + TypeScript, Fastify, PostgreSQL + Prisma, Zod validation, JWT auth
(argon2 password hashing), Vitest. Rationale in `docs/ARCHITECTURE_DECISIONS.md`.

## Quickstart

```bash
pnpm install
cp .env.example .env               # edit DATABASE_URL/secrets as needed
createdb tco_backend                # or point DATABASE_URL at an existing db
pnpm prisma:migrate                 # applies all migrations
pnpm prisma:seed                    # seeds the 8 global operating profiles
pnpm dev                            # starts on PORT from .env (default 8000)
```

```
curl localhost:8000/health
curl localhost:8000/ready
```

## API documentation

Interactive Swagger UI: `http://localhost:8000/docs`. Raw OpenAPI 3 spec:
`http://localhost:8000/openapi.json`. Generated directly from each route's
`schema` option (reusing the existing zod request schemas via `z2j()` in
`src/shared/zodSchema.ts`) rather than hand-maintained — `API_CONTRACT.md`
stays the prose version, this is the live one. Request validation is still
the existing manual `zod.parse()` in each handler; the attached schemas are
documentation-only (see `src/app/openapi.ts`).

## Scripts

- `pnpm dev` — watch mode (tsx)
- `pnpm build` / `pnpm start` — compiled production run
- `pnpm test` — Vitest (integration tests need `DATABASE_URL` pointed at a
  real Postgres — no mocked ORM layer)
- `pnpm lint` / `pnpm typecheck`
- `pnpm prisma:migrate` / `pnpm prisma:seed`

## Phase overview

Phases 0–8 are implemented: discovery/architecture docs, health/config
foundation, auth (Organization/User/Membership/RefreshToken, JWT access +
rotated refresh), the Fleet/Asset domain (Fleet, OperatingProfile,
Locomotive, SystemNode, Assembly, Component), the cost domain
(MaintenanceSchedule, append-only CostRecord), the canonical TCO engine
(adapted from the frontend's `tcoEngine.ts` — see
`docs/TCO_ENGINE_SPECIFICATION.md` for exactly how it differs, persisted as
`TcoRun`), OpenAPI documentation generated from the existing route schemas,
the Scenario domain (CRUD + scenario-driven TCO runs — new design, not a
port; the frontend never actually applies a scenario to any calculation, see
`docs/CANONICAL_DOMAIN_MODEL.md`), and a Monte Carlo simulation engine
(`SimulationRun`, synchronous, seeded/reproducible, reusing the canonical
TCO engine per trial — see `docs/SIMULATION_ENGINE_SPECIFICATION.md`).

BOM/Parts/Vendors, forecasting/benchmarking/sustainability, integrations,
reporting, CI, async simulation workers, and the frontend cutover are
deliberately not built yet — see "Explicitly deferred" in
`docs/CANONICAL_DOMAIN_MODEL.md` and `docs/IMPLEMENTATION_LOG.md`.

Full API surface: `docs/API_CONTRACT.md`. Schema: `docs/DATABASE_MODEL.md`.
Module layout: `docs/ARCHITECTURE.md`.
