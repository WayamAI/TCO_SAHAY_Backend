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
| GET /organizations/me | any authenticated role | `organizations/routes.test.ts` |
| PATCH /organizations/me | ADMIN | `organizations/routes.test.ts` |
| GET /users | any authenticated role | `users/routes.test.ts` |
| POST /users | ADMIN | `users/routes.test.ts` (also asserts VIEWER gets 403) |
| PATCH /users/:userId/role | ADMIN | `users/routes.test.ts` (single combined test — not separately titled) |
| DELETE /users/:userId | ADMIN | `users/routes.test.ts` (single combined test — not separately titled) |

`organizations/routes.test.ts` (added since this audit was first written — 5 tests) now covers: own-org read, 401 unauthenticated, ADMIN rename, non-ADMIN 403, and cross-org isolation ("renaming caller A's organization never affects organization B").

Tenant isolation for org/user listing is covered end-to-end by `src/tests/tenant-isolation.test.ts` ("two organizations get distinct ids and tokens scoped to themselves").

## Fleets / Locomotives (`src/modules/fleets/routes.ts`)

**Previously flagged gap resolved**: `fleets/routes.test.ts` now exists (4 tests, added in `9f1c7c3`, after this audit was first written): "creates, lists, retrieves, renames, and archives a fleet", "rejects cross-organization read, update, and delete with 404", "lists global and org-custom operating profiles, scoped to the caller", and "un-archives a fleet via PATCH { archived: false }" (added in this pass — see below).

| Method/Path | Auth | Test coverage |
|---|---|---|
| GET /fleets | any role | `fleets/routes.test.ts` |
| POST /fleets | ADMIN, MANAGER | `fleets/routes.test.ts` |
| GET /fleets/:fleetId | any role | `fleets/routes.test.ts` |
| PATCH /fleets/:fleetId | ADMIN, MANAGER | `fleets/routes.test.ts` |
| DELETE /fleets/:fleetId | ADMIN | `fleets/routes.test.ts` |
| GET /locomotives (nested under fleets module, route confirmed in openapi path list `/locomotives`) | any role | exercised by `simulation/routes.test.ts` setup and `assets/routes.test.ts` |

**Bug found and fixed in this pass**: `PATCH /fleets/:fleetId` with `{ archived: false }` was a silent no-op (`archivedAt: body.archived ? new Date() : undefined` — Prisma ignores `undefined`, so an archived fleet could never be un-archived via PATCH). Fixed to use `null` when `archived` is explicitly `false`, distinct from `undefined` when the field is omitted. See `IMPLEMENTATION_LOG.md`.

## Assets (components/operating-profiles) (`src/modules/assets/routes.ts`)

12 routes covering locomotives, operating-profiles, and the system/assembly/component hierarchy, all behind `authenticate` + `requireRole('ADMIN'|'MANAGER')` for writes, `DELETE` restricted to `ADMIN`. Test coverage: `assets/routes.test.ts` (3 tests): "creates a fleet and locomotive, retrieves tree, and blocks cross-org access", "creates a system and an assembly under it via HTTP, buildable end to end", "rejects creating a system or assembly on another organization's locomotive". Still not branch-complete per-route (e.g. no dedicated test for `PATCH/DELETE /components/:id` RBAC-denied cases) — see gap list below.

**Confirmed via live HTTP verification (not just reading code), recorded in `IMPLEMENTATION_LOG.md`**: `GET /locomotives/:id` returns the full nested `systems → assemblies → components` tree matching the frontend's expected shape field-for-field, and cross-org access to it returns 404.

## Costs (`src/modules/costs/routes.ts`)

6 routes: maintenance-schedules have full CRUD with a **hard delete** (`prisma.maintenanceSchedule.delete`, not soft); cost-records are **append-only** (`GET`/`POST` only — no `PATCH`/`DELETE` routes exist, corrections are new rows, per the route file's own comment). Same RBAC pattern as other write endpoints. Test coverage: `costs/routes.test.ts` (2 tests: "creates a maintenance schedule and cost records, and lists them filtered", "rejects cross-org maintenance schedule and cost record access with 404").

## TCO (`src/modules/tco/routes.ts`)

| Method/Path | Auth | Notes |
|---|---|---|
| POST /tco/runs | any authenticated role (no `requireRole`) | `{ locomotiveId, horizonYears?, scenarioId? }`; response 201 has `data` envelope |
| GET /tco/runs/:id | any authenticated role | |
| GET /locomotives/:id/tco-runs | any authenticated role | history list |

**Open question, not changed in this pass**: `POST /tco/runs` and `POST /simulation-runs` have no `requireRole` gate, so a `VIEWER` can trigger a persisted calculation — unlike every other write endpoint in the API, which requires `ADMIN`/`MANAGER`. No doc or spec states whether this is deliberate (a "run" is read-like even though it persists a row) or an oversight. Left unchanged pending a product decision, per the instruction not to guess at undocumented authorization semantics.

Test coverage: `tco/routes.test.ts` (4 tests: "runs the TCO engine for a locomotive, persists it, and lists history", "applies scenario assumptions to the TCO run and produces the expected result", "scenario.includeDowntime adds downtime cost to the persisted TCO run", "rejects a scenarioId from another organization with 404"), `tco/engine.test.ts` (pure engine math).

**Live-verified in this pass** (see `IMPLEMENTATION_LOG.md`): toggling `includeDowntime` via a real scenario changed a persisted run's `events[0].downtimeCost` from `0` to `2500` on identical component data — confirms the unit-test claim against a running server + real Postgres, not just mocked test fixtures.

## Scenarios (`src/modules/scenarios/routes.ts`)

Full CRUD (GET list, POST create [ADMIN/MANAGER], GET by id, PATCH [ADMIN/MANAGER], DELETE [ADMIN; hard delete, not soft]). Test coverage: `scenarios/routes.test.ts` (2 tests: "supports full CRUD and role enforcement", "enforces tenant isolation: Org A cannot read or write Org B scenarios").

**Confirmed live** (`IMPLEMENTATION_LOG.md`): scenario creation requires all 9 fields (`planningHorizonYears`, `discountRate`, `laborRate`, `maintenanceIntervalMultiplier`, `failureRateMultiplier`, `warrantyExtendedYears`, `fuelCostPerLiter`, `inflationEnabled`, `includeDowntime`) — no server-side defaults. A frontend creation form must collect every field, not just the ones currently applied by the TCO engine (`laborRate`/`discountRate`/`inflationEnabled`/`fuelCostPerLiter` remain stored-but-inert per `TCO_ENGINE_SPECIFICATION.md`).

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

## Coverage gaps identified (current as of 2026-10-13 re-audit)

Resolved since this document was first written: `fleets` and `organizations` both now have dedicated `routes.test.ts` files (items 1 and a prior organizations gap, closed by later commits `9f1c7c3` and `5291a1b` respectively — this document had not been updated to reflect that until now).

Still open:

1. `assets/routes.test.ts` (3 tests) is not branch-complete per-route — no dedicated test for `PATCH/DELETE /components/:id` RBAC-denied cases, or for the system/assembly ownership-chain rejection beyond the one cross-org test. Smallest safe next step: extend with per-route happy-path + RBAC-denied cases, following the `users/routes.test.ts` pattern.
2. `auth/routes.test.ts` only tests rate-limiting (429s); register/login/refresh/logout happy- and error-paths are tested in `auth/service.test.ts` instead, one layer below the route. Not a functional gap, but means no test exercises the actual HTTP request/response shape for a successful login/refresh/logout.
3. `users/routes.test.ts` has one combined test covering admin-view/list/add/VIEWER-forbidden; role-change (`PATCH /users/:userId/role`) and deactivate (`DELETE /users/:userId`) have no separately-titled assertions, though the combined test does exercise the code paths.
4. `costs/routes.test.ts` doesn't have a test explicitly asserting the maintenance-schedule hard-delete vs. cost-record append-only (no PATCH/DELETE) distinction, though the route registration itself makes the restriction structural (the routes simply don't exist), not merely conventional.
5. **System/Assembly CRUD gap** (unresolved, documented in `IMPLEMENTATION_LOG.md`): `SystemNode`/`Assembly` only support `POST` (create) — no list, individual read, update, or delete — while `Locomotive`/`Component` have full CRUD. Live-verified in this pass that `GET /locomotives/:id`'s nested tree already covers *read* access to systems/assemblies, so this gap is now scoped specifically to *renaming/deleting* a system or assembly without recreating the whole locomotive. Still blocked on a frontend/product decision — no doc confirms this is needed, and neither model has a `deletedAt` column, so a delete endpoint would require a migration.
6. **Undocumented authorization asymmetry**: `POST /tco/runs` and `POST /simulation-runs` allow any authenticated role (including VIEWER) to trigger a persisted write, unlike every other mutating endpoint in the API which requires ADMIN/MANAGER. Not changed — no spec states whether this is intentional.

No endpoints were found that are undocumented in the OpenAPI spec, and no spec entries were found without a backing route.
