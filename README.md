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

## Scripts

- `pnpm dev` — watch mode (tsx)
- `pnpm build` / `pnpm start` — compiled production run
- `pnpm test` — Vitest (integration tests need `DATABASE_URL` pointed at a
  real Postgres — no mocked ORM layer)
- `pnpm lint` / `pnpm typecheck`
- `pnpm prisma:migrate` / `pnpm prisma:seed`

## Phase overview

Phases 0–6 are implemented: discovery/architecture docs, health/config
foundation, auth (Organization/User/Membership/RefreshToken, JWT access +
rotated refresh), the Fleet/Asset domain (Fleet, OperatingProfile,
Locomotive, SystemNode, Assembly, Component), the cost domain
(MaintenanceSchedule, append-only CostRecord), and the canonical TCO engine
(ported from the frontend's `tcoEngine.ts`, persisted as `TcoRun`).

Scenario/simulation persistence, BOM/Parts/Vendors, forecasting/
benchmarking/sustainability, integrations, reporting, and the frontend
cutover are deliberately not built yet — see "Explicitly deferred" in
`docs/CANONICAL_DOMAIN_MODEL.md` and the plan file this was built from.

Full API surface: `docs/API_CONTRACT.md`. Schema: `docs/DATABASE_MODEL.md`.
Module layout: `docs/ARCHITECTURE.md`.
