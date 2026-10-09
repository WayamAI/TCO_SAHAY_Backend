# Phase 9 — API Contract Audit

Source of truth: live `/openapi.json` route served by `@fastify/swagger` (`src/app/buildApp.ts`), cross-checked against each module's `routes.ts`. The spec's completeness/accuracy is itself asserted by `src/app/openapi.test.ts` (route-group coverage, bearer security scheme, request/response schema shape, 409/404 error documentation). No endpoint below was invented — every path listed is registered in a `routes.ts` file and appears in `spec.paths`.

Auth model: JWT bearer (`security: bearerAuth`), enforced via `preHandler: authenticate` (JWT verification) and, where noted, `requireRole('ADMIN'|'MANAGER'|'VIEWER')` for RBAC. Tenant isolation is enforced at the service layer via `organizationId` scoping on every Prisma query (confirmed in `simulation/service.ts`, and by `src/tests/tenant-isolation.test.ts`).

## Auth (`src/modules/auth/routes.ts`) — no auth required (these *are* the auth endpoints)

| Method/Path | Request | Response | Error behavior | Test coverage |
|---|---|---|---|---|
| POST /auth/register | email, password, orgName (zod) | 201 user+org+tokens | 409 if email exists (asserted in `openapi.test.ts`) | `auth/service.test.ts` |
| POST /auth/login | email, password | 200 tokens | 401 invalid credentials | `auth/service.test.ts` |
| POST /auth/refresh | refreshToken | 200 new tokens | 401 invalid/expired | `auth/service.test.ts` |
| POST /auth/logout | refreshToken | 200 | — | `auth/service.test.ts` |

## Organizations/Users

| Method/Path | Auth | Test coverage |
|---|---|---|
| GET /organizations/me | any authenticated role | `users/routes.test.ts` |
| PATCH /organizations/me | ADMIN | `users/routes.test.ts` |
| GET /users | any authenticated role | `users/routes.test.ts` |
| POST /users | ADMIN | `users/routes.test.ts` (also asserts VIEWER gets 403) |
| PATCH /users/:id | ADMIN | `users/routes.test.ts` |
| DELETE /users/:id | ADMIN | `users/routes.test.ts` |

Tenant isolation for org/user listing is covered end-to-end by `src/tests/tenant-isolation.test.ts` ("two organizations get distinct ids and tokens scoped to themselves").

## Fleets / Locomotives (`src/modules/fleets/routes.ts`)

| Method/Path | Auth | Test coverage |
|---|---|---|
| GET /fleets | any role | `fleets` has no dedicated routes.test.ts file found; covered indirectly via `openapi.test.ts` (security scheme assertion uses this exact route) and exercised by simulation/tco setup flows in other test files. **Gap: no standalone CRUD test file for fleets module.** |
| POST /fleets | ADMIN, MANAGER | same as above |
| GET /fleets/:fleetId | any role | `openapi.test.ts` asserts 404 response is documented |
| PATCH /fleets/:fleetId | ADMIN, MANAGER | — |
| DELETE /fleets/:fleetId | ADMIN | — |
| GET /locomotives (nested under fleets module, route confirmed in openapi path list `/locomotives`) | any role | exercised by `simulation/routes.test.ts` setup (creates locomotives via this path) |

## Assets (components/operating-profiles) (`src/modules/assets/routes.ts`)

9 routes covering operating-profiles and locomotive components/assemblies CRUD, all behind `authenticate` + `requireRole('ADMIN'|'MANAGER')` for writes, `DELETE` restricted to `ADMIN`. Test coverage: `assets/routes.test.ts` (1 test — smoke-level; does not appear to cover every CRUD branch individually).

## Costs (`src/modules/costs/routes.ts`)

6 routes (cost-records CRUD + maintenance-schedules). Same RBAC pattern. Test coverage: `costs/routes.test.ts`.

## TCO (`src/modules/tco/routes.ts`)

| Method/Path | Auth | Notes |
|---|---|---|
| POST /tco/runs | any role | Request schema requires `locomotiveId`, `horizonYears` (asserted directly in `openapi.test.ts`); response 201 has `data` envelope |
| GET /tco/runs/:id | any role | |
| GET /locomotives/:id/tco-runs | any role | history list |

Test coverage: `tco/routes.test.ts`, `tco/engine.test.ts` (pure engine math).

## Scenarios (`src/modules/scenarios/routes.ts`)

Full CRUD (GET list, POST create [ADMIN/MANAGER], GET by id, PATCH [ADMIN/MANAGER], DELETE [ADMIN]). Test coverage: `scenarios/routes.test.ts`.

## Simulation (Phase 8) — `src/modules/simulation/routes.ts`

| Method/Path | Auth | Request | Response | Notes |
|---|---|---|---|---|
| POST /simulation-runs | authenticate (any role) | `{ locomotiveId, horizonYears?, scenarioId?, iterations? (100-10000, default 1000), seed? }` (zod `runSchema`, routes.ts lines 10-16) | 201 `{ data: SimulationRun }` | 404 if locomotive/scenario not found, 400 on validation failure |
| GET /simulation-runs/:id | authenticate | params `{id}` | 200 `{ data: SimulationRun }` | 404 if not found or wrong org |
| GET /locomotives/:id/simulation-runs | authenticate | params `{id}` | 200 `{ data: SimulationRun[] }` | history list, 404 if locomotive not found |

`SimulationRun`'s `config`/`summary`/`percentiles`/`histogram` fields are JSON columns documented narratively (not expanded as strict JSON Schema) — same convention already used for `TcoRun.inputs`/`outputs`; this is an intentional, pre-existing convention, not an audit gap.

### Simulation engine verification (code-cited)

- **No duplicate TCO math:** `src/modules/simulation/engine.ts` line 4 (`import { locomotiveTco, ... } from '../tco/engine.js'`) and line 82 (`const trial = locomotiveTco(perturbedComponents, input.horizonYears, input.event, failureRateMultiplier)`) — every Monte Carlo trial re-runs the canonical deterministic TCO engine.
- **Iteration limits:** `MIN_ITERATIONS = 100`, `DEFAULT_ITERATIONS = 1000`, `MAX_ITERATIONS = 10000` (`engine.ts` lines 11-13), enforced in both the Zod route schema and `validateSimulationInput`/`service.ts`.
- **Reproducibility:** same seed + iterations → identical result, confirmed by `simulation/routes.test.ts` line 154 (`'is reproducible for the same seed and iterations'`).
- **Seed divergence:** different/auto-generated seeds → different results, confirmed by `routes.test.ts` line 175.
- **Numeric safety guards:** `assertFiniteNonNegative` (engine.ts lines 55-59) throws on any non-finite/negative trial result or summary stat.
- **Fixed distribution constants (documented limitation, unchanged):** cost multiplier triangular `{min: 0.85, mode: 1.0, max: 1.2}` and failure-rate lognormal COV `0.25` (engine.ts lines 17-18) are hardcoded, not request parameters. Only `totalCost` is simulated — not per-component or customer/org-level TCO. This matches the Phase 8 implementation log exactly and was not altered.
- **Persistence model:** only summary/percentiles/histogram JSON is persisted to `SimulationRun`; raw per-trial arrays are not stored (schema + routes.ts comment, lines 21-23).
- **Tenant isolation:** `service.ts` scopes every `prisma.locomotive.findFirst`/`scenario.findFirst`/`simulationRun` lookup by `organizationId`; confirmed by `routes.test.ts` line 231 (`'enforces tenant isolation at the service/DB boundary: Org B cannot read Org A runs or list them'`).

## Coverage gaps identified (not fixed — documented per audit scope)

1. `fleets` module has no dedicated `routes.test.ts` (other modules do). Smallest safe next step: add a CRUD test file mirroring `scenarios/routes.test.ts`'s structure.
2. `assets/routes.test.ts` is a single smoke test for 9 routes — not branch-complete. Smallest safe next step: extend with per-route happy-path + RBAC-denied cases, following the `users/routes.test.ts` pattern (which already asserts a 403 for an under-privileged role).

No endpoints were found that are undocumented in the OpenAPI spec, and no spec entries were found without a backing route.
