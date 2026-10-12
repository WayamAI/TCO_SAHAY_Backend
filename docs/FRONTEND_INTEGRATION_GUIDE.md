# Frontend Integration Guide

Practical guide for wiring `locomotive_wabtec-main` (or any client) to this
backend. For the full endpoint reference see `docs/API_CONTRACT.md`; for
the current state of frontend/backend compatibility see
`docs/FRONTEND_BACKEND_COMPATIBILITY.md` and
`docs/INTEGRATION_READINESS_REPORT.md`. This file is the "how", those are
the "what" and "where it stands".

## 1. Local startup

```bash
pnpm install
cp .env.example .env     # edit DATABASE_URL/secrets as needed
createdb tco_backend
pnpm prisma:migrate
pnpm prisma:seed         # seeds the 8 global operating profiles
pnpm dev                 # listens on PORT from .env, default 8000
```

If `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`, that is pnpm's
supply-chain policy blocking lifecycle scripts for `@prisma/client`,
`prisma`, `argon2`, and `esbuild` until `pnpm approve-builds` is run once,
interactively, by a human. Don't run that blindly in an automated context —
use the already-installed binaries directly (`./node_modules/.bin/tsc`,
`vitest`, `eslint`, `prisma`) if you need to validate without approving
build scripts.

## 2. Required environment variables

Names only — see `.env.example` for the shape, never commit real values:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_ACCESS_SECRET` | Signs 15-minute access tokens |
| `JWT_REFRESH_SECRET` | Reserved for future use — refresh tokens are currently opaque random strings, hashed at rest, not JWTs (see `auth/tokens.ts`) |
| `CORS_ORIGINS` | Comma-separated explicit allowlist, e.g. `http://localhost:3000` — no wildcard support, add every frontend origin you need |
| `PORT` | Defaults to 8000 |
| `NODE_ENV` | `development` / `test` / `production` |

## 3. API base URL semantics

Every route is served under `/api/v1` except `/health`, `/ready`,
`/openapi.json`, and `/docs`. There is no versioning scheme beyond this
single static prefix — a frontend client should hardcode
`${API_BASE_URL}/api/v1` as its request root, where `API_BASE_URL` is an
env var the frontend currently does **not** have (see §6).

## 4. Authentication and token-refresh flow

All values below are dummy test data.

**Register** (creates an Organization + first ADMIN user):
```bash
curl -X POST $API_BASE_URL/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"organizationName":"Acme Rail","email":"admin@acme.test","password":"supersecret123"}'
```
```json
{
  "data": {
    "accessToken": "<jwt, 15 min TTL>",
    "refreshToken": "<opaque string, 30 day TTL>",
    "user": { "id": "...", "email": "admin@acme.test", "organizationId": "...", "role": "ADMIN" }
  }
}
```

**Login**: `POST /api/v1/auth/login` with `{ email, password }`, same
response shape. **Rate-limited** to 10 requests/minute per client IP —
expect a `429` after that, not a `401`, if you're hammering it in a test
loop.

**Authenticated requests**: `Authorization: Bearer <accessToken>` header.

**Refresh** (rotates the refresh token — the old one is revoked the moment
you use it, so don't call this twice with the same token):
```bash
curl -X POST $API_BASE_URL/api/v1/auth/refresh \
  -d '{"refreshToken":"<refreshToken>"}'
```

**Logout**: `POST /api/v1/auth/logout` with `{ refreshToken }` — revokes it.

**Known limitation**: if a user ever belongs to more than one organization,
login always resolves to their first membership with no way to pick
another. Today nothing in this API can actually create that state (no
route attaches an existing user to a second organization), so this is
currently unreachable, not a live bug — see `docs/IMPLEMENTATION_LOG.md`'s
2026-10-12 entry.

## 5. Representative requests per domain

**Fleet + locomotive + BOM tree** (SystemNode/Assembly creation was added in
this session — previously components had no way to attach to a tree built
purely over HTTP):
```bash
TOKEN=<accessToken>

# fleet
curl -X POST $API_BASE_URL/api/v1/fleets -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Main Fleet"}'

# locomotive (fleetId + operatingProfileId from GET /operating-profiles)
curl -X POST $API_BASE_URL/api/v1/locomotives -H "Authorization: Bearer $TOKEN" \
  -d '{"fleetId":"...","operatingProfileId":"...","model":"ES44AC","manufacturer":"GE","type":"Diesel","horsepower":4400,"purchaseCost":2500000,"commissionYear":2015,"plannedLifeYears":30,"annualKm":180000,"annualHours":4500,"fuelType":"Diesel","fuelCostPerUnit":0.9,"status":"Active"}'

# system -> assembly -> component
curl -X POST $API_BASE_URL/api/v1/locomotives/<id>/systems -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Propulsion","icon":"engine","criticality":"High"}'
curl -X POST $API_BASE_URL/api/v1/locomotives/<id>/systems/<systemId>/assemblies -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Traction"}'
curl -X POST $API_BASE_URL/api/v1/locomotives/<id>/components -H "Authorization: Bearer $TOKEN" \
  -d '{"assemblyId":"...","name":"Traction Motor","purchaseCost":10000,"replacementCost":10000,"lifeYears":5,"mtbfHours":40000,"weibullBeta":2,"weibullEta":50000,"mttrHours":12,"warrantyYears":7,"laborCostPct":18,"failureImpact":"High","category":"Propulsion","downtimeCostPerDay":5000}'
```

**Scenario + TCO run**:
```bash
curl -X POST $API_BASE_URL/api/v1/scenarios -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"Base Case","planningHorizonYears":20,"discountRate":5,"laborRate":100,"maintenanceIntervalMultiplier":1,"failureRateMultiplier":1,"warrantyExtendedYears":0,"fuelCostPerLiter":1.5,"inflationEnabled":false,"includeDowntime":true}'

curl -X POST $API_BASE_URL/api/v1/tco/runs -H "Authorization: Bearer $TOKEN" \
  -d '{"locomotiveId":"...","scenarioId":"..."}'
```
Of the scenario fields above, `planningHorizonYears`,
`maintenanceIntervalMultiplier`, `warrantyExtendedYears`,
`failureRateMultiplier`, and (as of this session) `includeDowntime` change
the output. `laborRate`, `discountRate`, `inflationEnabled`,
`fuelCostPerLiter` are accepted and persisted but do not affect the
result — see `docs/TCO_ENGINE_SPECIFICATION.md`'s field table for exactly
why each one is a documented gap rather than a bug.

**Monte Carlo simulation**:
```bash
curl -X POST $API_BASE_URL/api/v1/simulation-runs -H "Authorization: Bearer $TOKEN" \
  -d '{"locomotiveId":"...","scenarioId":"...","iterations":1000}'

curl $API_BASE_URL/api/v1/simulation-runs/<id> -H "Authorization: Bearer $TOKEN"
curl $API_BASE_URL/api/v1/locomotives/<id>/simulation-runs -H "Authorization: Bearer $TOKEN"
```
Response contains `summary` (mean/stdev/min/max), `percentiles`, and
`histogram` for `totalCost` only — no separate customer/organization
breakdown distribution exists yet.

## 6. Response and error shapes

Every success response is `{ "data": ..., "meta"?: {...} }` (list endpoints
add `meta.total`/`page`/`pageSize`). Every error is:
```json
{ "error": { "code": "SOME_CODE", "message": "human-readable", "details": {} } }
```
`VALIDATION_ERROR` (400) includes a Zod-flattened `details`. A trusted
Fastify plugin's own 4xx (e.g. `@fastify/rate-limit`'s 429) passes through
with its own message. Anything else unexpected is a generic 500 with no
stack trace or internal detail leaked.

## 7. CORS

`CORS_ORIGINS` is a literal comma-separated allowlist — add the frontend's
dev and deployed origins explicitly; there is no wildcard.

## 8. What the frontend does not have yet

As of this session, `locomotive_wabtec-main` has **no integration with this
backend at all** — no fetch/axios calls, no `NEXT_PUBLIC_API_*` env var, no
`.env.example`. It runs entirely on static mock data and a fake auth module
that accepts any credentials (`docs/INTEGRATION_READINESS_REPORT.md` has
the full detail). Building a base-URL env var and a minimal API client on
the frontend side, then wiring one read-only screen (e.g. the fleet list)
as a proof of connectivity, is the natural next step — not attempted here
since it requires changes in the frontend repository, which this backend
engagement does not touch.

## 9. Backend features not yet implemented

- No way to `PATCH`/delete a `SystemNode` or `Assembly` (only create —
  matching exactly what the audit asked for, nothing more).
- `laborRate`, `discountRate`, `inflationEnabled`, `fuelCostPerLiter` on
  `Scenario` are stored but inert (see §5 above).
- No CI pipeline (no GitHub remote exists for this repo to run one against).
- Simulation output has no per-customer/organization cost breakdown
  distribution, and its cost-multiplier distribution parameters are fixed
  constants, not request inputs.
