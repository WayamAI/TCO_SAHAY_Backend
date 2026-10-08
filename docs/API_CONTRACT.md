# API Contract (Phases 2–6 scope)

Base path: `/api/v1`. All responses use the envelope:

```json
// success
{ "data": {}, "meta": {} }
// error
{ "error": { "code": "RESOURCE_NOT_FOUND", "message": "...", "details": {} } }
```

`meta` carries pagination (`page`, `pageSize`, `total`) on list endpoints.
Every endpoint except `/health`, `/ready`, `/auth/*` requires
`Authorization: Bearer <accessToken>` and is scoped to the caller's
`organizationId` — a request for another org's resource returns `404`
(not `403`, to avoid confirming the resource exists).

## Health (Phase 2)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | none | process liveness only |
| GET | `/ready` | none | `SELECT 1` against Postgres |

## Auth (Phase 3)

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/auth/register` | none | `{organizationName, email, password}` | creates Organization + ADMIN User + Membership |
| POST | `/auth/login` | none | `{email, password}` | returns `{accessToken, refreshToken, user}` |
| POST | `/auth/refresh` | none | `{refreshToken}` | rotates refresh token |
| POST | `/auth/logout` | bearer | `{refreshToken}` | revokes it |

Errors: `INVALID_CREDENTIALS` (401), `EMAIL_TAKEN` (409), `TOKEN_EXPIRED` (401).

## Organizations / Users (Phase 3)

| Method | Path | Auth | Role |
|---|---|---|---|
| GET | `/organizations/me` | bearer | any |
| PATCH | `/organizations/me` | bearer | ADMIN |
| GET | `/users` | bearer | any | list members of caller's org |
| POST | `/users` | bearer | ADMIN | invite/create a member |
| PATCH | `/users/:userId/role` | bearer | ADMIN |
| DELETE | `/users/:userId` | bearer | ADMIN | deactivate, not hard delete |

## Fleets / Locomotives / Components (Phase 4)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/fleets` | bearer | paginated |
| POST | `/fleets` | bearer | ADMIN/MANAGER |
| GET | `/fleets/:fleetId` | bearer | |
| PATCH | `/fleets/:fleetId` | bearer | ADMIN/MANAGER |
| DELETE | `/fleets/:fleetId` | bearer | ADMIN |
| GET | `/operating-profiles` | bearer | seeded + org-custom |
| GET | `/locomotives?fleetId=` | bearer | filter/paginate |
| POST | `/locomotives` | bearer | ADMIN/MANAGER |
| GET | `/locomotives/:id` | bearer | includes system/assembly/component tree |
| PATCH | `/locomotives/:id` | bearer | ADMIN/MANAGER |
| DELETE | `/locomotives/:id` | bearer | ADMIN |
| GET | `/locomotives/:id/components` | bearer | flattened component list with dependency edges |
| POST | `/locomotives/:id/components` | bearer | ADMIN/MANAGER |
| PATCH | `/components/:id` | bearer | ADMIN/MANAGER |
| DELETE | `/components/:id` | bearer | ADMIN |

Validation: `purchaseCost`/`horsepower`/all cost fields must be ≥ 0;
`commissionYear` ≤ current year; `operatingProfileId` must belong to the
caller's org or be a seeded global profile.

## Cost domain (Phase 5)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/locomotives/:id/maintenance-schedules` | bearer | |
| POST | `/locomotives/:id/maintenance-schedules` | bearer | ADMIN/MANAGER |
| PATCH | `/maintenance-schedules/:id` | bearer | ADMIN/MANAGER |
| DELETE | `/maintenance-schedules/:id` | bearer | ADMIN |
| GET | `/locomotives/:id/cost-records?year=&category=` | bearer | filter/paginate |
| POST | `/locomotives/:id/cost-records` | bearer | ADMIN/MANAGER | append-only, no PATCH/DELETE — corrections are new rows |

## TCO engine (Phase 6)

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/tco/runs` | bearer | `{locomotiveId, horizonYears, scenarioId?}` | computes + persists a `TcoRun`, returns full breakdown. `laborPct` is not in the body — it's each `Component.laborCostPct`, already stored at Phase 4 |
| GET | `/tco/runs/:id` | bearer | | re-fetch a prior run |
| GET | `/locomotives/:id/tco-runs` | bearer | | history of runs for one locomotive |

## Scenarios (Phase 7)

Fleet-agnostic, org-scoped assumption bundles. See
`CANONICAL_DOMAIN_MODEL.md` for why this is new design rather than a port —
the frontend never implements "apply a scenario."

| Method | Path | Auth | Role | Notes |
|---|---|---|---|---|
| GET | `/scenarios` | bearer | any | paginated |
| POST | `/scenarios` | bearer | ADMIN/MANAGER | |
| GET | `/scenarios/:id` | bearer | any | |
| PATCH | `/scenarios/:id` | bearer | ADMIN/MANAGER | |
| DELETE | `/scenarios/:id` | bearer | ADMIN | hard delete — `TcoRun.scenarioId` is set null on runs that used it |

`POST /tco/runs` accepts an optional `scenarioId`. When present: the
scenario's `maintenanceIntervalMultiplier`/`failureRateMultiplier`/
`warrantyExtendedYears` are applied to every component before the engine
runs, its `operatingProfileId` (if set) overrides the locomotive's own
profile for that run's annual-hours figure, and its
`planningHorizonYears` is used as the horizon unless the caller passes an
explicit `horizonYears`. See `TCO_ENGINE_SPECIFICATION.md` for the exact
per-field mapping and which Scenario fields are stored but not yet applied.

## Error codes used across all of the above

`VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `INVALID_CREDENTIALS` (401),
`TOKEN_EXPIRED` (401), `FORBIDDEN_ROLE` (403), `RESOURCE_NOT_FOUND` (404),
`EMAIL_TAKEN` / `CONFLICT` (409), `INTERNAL_ERROR` (500, never leaks a stack
trace to the client — logged server-side with the request id instead).

## Explicitly out of scope here

`/scenarios`, `/simulations`, `/parts`, `/vendors`, `/benchmarks`,
`/forecasts`, `/integrations`, `/reports` — each is a later phase's own
contract addition.
