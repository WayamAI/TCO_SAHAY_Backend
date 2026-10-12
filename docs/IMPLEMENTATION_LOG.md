# Implementation Log

## 2026-10-08 — Phases 0–6

Built the backend from empty repo through the canonical TCO engine, in 44
atomic commits (`git log --oneline` is the authoritative list; summarized by
phase below). Full verification run after each phase: `pnpm lint && pnpm
typecheck && pnpm test` all green; `prisma migrate dev` applied cleanly
against a local Postgres (`tco_backend` db) with no manual intervention;
`pnpm prisma:seed` run twice confirmed idempotent (no duplicate rows).

**Phase 0 (1 commit):** `docs/FRONTEND_DOMAIN_INVENTORY.md`, derived from a
full read-only exploration of `locomotive_wabtec-main`.

**Phase 1 (5 commits):** `ARCHITECTURE_DECISIONS.md`, `CANONICAL_DOMAIN_MODEL.md`,
`API_CONTRACT.md`, `ARCHITECTURE.md`, `DATABASE_MODEL.md`.

**Phase 2 (9 commits):** repo init, env config, AppError hierarchy, global
error handler, Prisma init, health/ready endpoints + tests, Fastify
entrypoint, pnpm build approvals. Verified: `curl localhost:PORT/health` →
`{"data":{"status":"ok"}}`; `/ready` correctly reports `NOT_READY` with no
reachable Postgres and `ready` once pointed at one.

**Phase 3 (10 commits):** Organization/User/Membership/RefreshToken schema +
migration, password hashing, JWT access/refresh tokens, auth service
(register/login/refresh/logout), authenticate/requireRole middleware, auth
routes, organization/member management routes, and the mandatory
cross-tenant isolation test (extended in later phases rather than
duplicated). Verified via integration tests against a real database (no
mocked Prisma): register → login → refresh-rotation → reuse-rejection →
logout-revocation, plus role-based 403 on a non-admin member-management
attempt.

**Phase 4 (8 commits):** Fleet/OperatingProfile/Locomotive/SystemNode/
Assembly/Component/ComponentDependency schema + migration, pagination
helper, fleet + operating-profile routes, locomotive + component routes,
idempotent seed of the 8 frontend operating profiles, integration tests
proving a second organization gets `404` (not `403`) on another org's
fleet/locomotive.

**Phase 5 (4 commits):** MaintenanceSchedule/CostRecord schema + migration,
cost domain routes (cost-records is list+create only — no PATCH/DELETE, per
the append-only ledger design), integration tests covering category
filtering and total counts.

**Phase 6 (6 commits):** TcoRun schema + migration, the TCO engine itself
(`src/modules/tco/engine.ts` — ported from the frontend's `tcoEngine.ts`,
adapted to run on `Component` instead of `Part` since Part/BOM is deferred
to a later phase; same three governing rules: component-specific
maintenance events, labor as a derived percentage, customer-vs-organization
warranty split), unit tests for the engine's math (labor derivation, Weibull
monotonicity, warranty-window flagging, determinism), the run service +
endpoints, and an end-to-end integration test that builds a real locomotive
+ component through the API and verifies the persisted run's output.

Plus one lint-fix commit (two unused-variable errors from `eslint .`).

## 2026-10-08 — Phase 7 (OpenAPI + Scenario domain)

22 further atomic commits (45–68 inclusive in `git log --oneline --reverse`)
continuing from the verified Phase 0–6 state — no rewrites, no restarts.
Full verification after every commit: `lint`/`typecheck`/`test` all green;
final pass confirmed `prisma migrate status` reports "up to date" (5
migrations) and 30/30 tests pass.

**Part vs Component TCO analysis.** Before touching OpenAPI, did the
mandated side-by-side comparison of the frontend's Part-level `tcoEngine.ts`
against the backend's Component-level `engine.ts` and wrote the result into
`docs/TCO_ENGINE_SPECIFICATION.md`. Conclusion: **not equivalent** — the
clearest gap is warranty checked by years only (no km check, since Component
has no `warrantyKm`), plus the failure-probability source differs entirely
(frontend: a calibrated stored field; backend: a live Weibull calculation).
Classified as a deliberate interim abstraction with bounded, now-documented
lossiness, not a bug. Added a regression-guard unit test
(`engine.test.ts`'s "documents the known warranty-km gap") that pins today's
behavior so a future change shows as a visible diff.

**OpenAPI/Swagger (8 commits).** Added `@fastify/swagger` +
`@fastify/swagger-ui` + `zod-to-json-schema`. Every existing route across
auth/organizations/users/fleets/assets/costs/tco gained a `schema` block
reusing the existing zod request schemas via a new `z2j()` helper — no
validation logic changed, request validation is still each handler's manual
`zod.parse()`. **Caught and fixed a real bug in the same pass**: attaching
response schemas made Fastify's default serializer (fast-json-stringify)
silently strip any field not declared in the schema, which broke pagination
(`meta.total` disappeared) the moment schemas were added to list routes. Fix
was a no-op serializer compiler alongside the existing no-op validator
compiler, keeping both request and response schemas documentation-only.
Verified with 6 new tests in `src/app/openapi.test.ts` checking the spec
actually represents routes/auth/TCO schemas/error responses, not just that
`/docs` returns 200.

**Scenario domain (new design, not a port) (12 commits).** Re-inspected the
frontend's scenario feature in full before writing any schema — finding:
`setActiveScenario()` is a pure label-setter never wired to the simulation
engine, the Scenario Comparator renders static hand-authored `tco` numbers
through a synthetic display curve, and there is no create/edit/duplicate/
delete UI, no persistence, and no `locomotiveId` binding anywhere in the
codebase. Documented this explicitly in `CANONICAL_DOMAIN_MODEL.md` so the
backend's CRUD + scenario-application logic is never mistaken for a port.
Added: `Scenario` model (flat, fleet-agnostic, matching the frontend's field
names) + migration; `TcoRun.scenarioId` (nullable, `onDelete: SetNull`) +
migration; full CRUD routes with OpenAPI docs and tenant isolation tests;
a field-by-field "Scenario application" table in
`TCO_ENGINE_SPECIFICATION.md` naming exactly which fields the engine applies
(`maintenanceIntervalMultiplier`, `failureRateMultiplier`,
`warrantyExtendedYears`, `operatingProfileId`, `planningHorizonYears`) vs.
stores for later (`laborRate`, `inflationEnabled`, `includeDowntime`,
`discountRate`, `fuelCostPerLiter` — several of these are dead on the
frontend too). The transformation lives in `tco/service.ts`, not
`engine.ts` — the engine only gained one new parameter
(`failureRateMultiplier`, default 1) because that's genuinely part of the
buffer formula; interval/warranty overrides are a service-level input
transform. Added a scenario-to-TCO integration test that hand-computes the
expected event count, warranty split, and buffer from the scenario's
multipliers and asserts the service produces exactly those numbers (not
just "a different number").

## Deliberate scope boundary

BOM/Parts/Vendors, Monte Carlo simulation (explicitly deferred per
instruction — "do not immediately implement Phase 8"), forecasting/
benchmarking/sustainability, integrations, reporting, audit log, and any
frontend code change remain out of scope. The frontend repository was
modified in zero commits this phase either — only read, twice, for domain
discovery (scenario re-inspection via a dedicated subagent).

## Remaining issues / known gaps

- No CI pipeline configured yet — tests run locally against a
  Homebrew-managed Postgres 14 instance.
- `prisma migrate dev` used throughout (dev workflow); production should use
  `prisma migrate deploy` per `ARCHITECTURE_DECISIONS.md`.
- `laborRate`, `inflationEnabled`, `includeDowntime`, `discountRate`, and
  `fuelCostPerLiter` are stored on `Scenario` but not applied by the TCO
  engine — see the table in `TCO_ENGINE_SPECIFICATION.md` for why each one
  isn't, and what engine feature each would need first.
- No "duplicate scenario" endpoint — deliberately: a client can `POST` a
  copy of an existing scenario's fields; a dedicated endpoint would be a
  thin wrapper with no behavior of its own (see `CANONICAL_DOMAIN_MODEL.md`).

## Next recommended atomic step

Phase 8 (Monte Carlo simulation) should build on the now-working
`Scenario → TCO engine` path rather than becoming a second calculation
system — start by deciding where a reproducible random seed is stored
(likely a new `SimulationRun` table paralleling `TcoRun`, not a field bolted
onto `TcoRun` itself, since a simulation run has a materially different
output shape: percentile distributions, not a single breakdown) and write
that decision into a new `docs/SIMULATION_ENGINE_SPECIFICATION.md` before
touching schema or code, same discipline as this phase.

## 2026-10-09 — Phase 8: Simulation Engine (Monte Carlo)

**Objective:** add a Monte Carlo simulation capability that reuses the
canonical TCO engine per trial, producing a `totalCost` distribution
(summary stats, percentiles, histogram) alongside — never replacing — the
deterministic `TcoRun`.

**Spec decisions** (`docs/SIMULATION_ENGINE_SPECIFICATION.md`, written
first): only two stochastic variables are justified — a failure-rate
multiplier (lognormal, median = scenario's `failureRateMultiplier` or 1,
CoV 0.25) and a cost multiplier (triangular, 0.85/1.0/1.2, fixed constants).
No other Scenario field is newly applied. Raw trials are never persisted,
only config + summary + percentiles + a 20-bin histogram. Seed is a string,
caller-supplied or generated, hashed into a `mulberry32` PRNG — `Math.random`
is never used in a trial.

**Implementation decisions:**
- `src/modules/simulation/rng.ts` — seeded PRNG + seed generator.
- `src/modules/simulation/distributions.ts` — lognormal (via Box-Muller
  standard normal) and triangular samplers only.
- `src/modules/simulation/statistics.ts` — mean/median/variance/stddev,
  linear-interpolated percentiles, equal-width histogram.
- `src/modules/simulation/engine.ts` — `runSimulation()` samples both
  multipliers per trial and calls `locomotiveTco()` from
  `tco/engine.ts` unchanged — no second TCO calculation path. Validates
  iterations (100–10,000) and numeric safety (NaN/Infinity/negative) before
  returning.
- `src/modules/simulation/service.ts` — resolves locomotive/scenario with
  the exact same field mapping as `tco/service.ts`'s `runTco()`, then
  persists a `SimulationRun`.
- `src/modules/simulation/routes.ts` — `POST /simulation-runs`,
  `GET /simulation-runs/:id`, `GET /locomotives/:id/simulation-runs`. No
  `DELETE`, following `TcoRun`'s precedent (only `Scenario` has hard delete).

**Schema changes:** new `SimulationRun` model (migration
`20261009045024_simulation_runs`) alongside `TcoRun`: `organizationId`,
`locomotiveId`, `scenarioId?`, `horizonYears`, `iterations`, `seed`,
`engineVersion`, `config`/`summary`/`percentiles`/`histogram` JSON,
`createdByUserId`, `createdAt`. Indexed the same way as `TcoRun`.

**API changes:** 3 new endpoints under `/api/v1`, documented in OpenAPI
(`tags: ['simulation']`); `/simulation-runs` paths now appear in
`/openapi.json` (asserted by a new test mirroring commit 5ef4d84's pattern
for Scenario).

**Performance / sync vs async:** benchmarked `runSimulation` directly (8
components, horizon 20y): 100 iterations ≈ 2.7ms, 1,000 ≈ 12.5ms, 10,000 ≈
68ms. All well within a synchronous HTTP request/response; no queue, worker,
or Redis was added. Iteration limits: min 100, default 1000, max 10,000.

**Tests (all passing, 72/72 total suite, up from the 30/30 baseline — no
existing test was touched or weakened):**
- `rng.test.ts` (4): deterministic sequence, distinct seeds, range, seed
  generator uniqueness.
- `distributions.test.ts` (9): lognormal positivity/median/invalid params,
  triangular bounds/degenerate case/invalid params, standard normal mean.
- `statistics.test.ts` (11): single-value, identical-value, unsorted-input,
  empty-input, histogram collapse/distribution/empty.
- `engine.test.ts` (11): exact-equality reproducibility for identical
  seed/inputs/iterations, distinct output structure for a different seed,
  stochastic variance, iteration min/default/max acceptance and rejection,
  invalid `baseFailureMultiplier`/empty components/empty seed rejection.
- `routes.test.ts` (7): create/retrieve/list, response fields not stripped
  by the Fastify response schema, reproducibility over HTTP, distinct
  auto-generated seeds, default/min/max iteration validation over HTTP, auth
  required, cross-tenant read/list rejection at both the HTTP layer and
  directly via the service function (bypassing route middleware), unknown
  locomotive 404.
- `openapi.test.ts` extension (existing file, +1 assertion set): the 3 new
  paths appear in the generated spec.

**Validation results:** `pnpm lint` clean, `pnpm typecheck` clean, `pnpm
test` 72/72, `pnpm run build` clean, `npx prisma validate` valid, `npx prisma
migrate status` up to date (6 migrations). `git status --short` clean after
every commit.

**Known limitations / deferred work:**
- Only `totalCost` is simulated; `customerTCO`/`organizationTCO`
  distributions are a derivable future addition, not built here (see spec's
  "Why `totalCost`").
- `laborRate`, `inflationEnabled`, `includeDowntime`, `fuelCostPerLiter`
  remain unapplied by both the TCO and simulation engines — unchanged from
  Phase 7, not reinterpreted as simulation inputs.
- No CI pipeline (unchanged from Phase 7 — out of scope for Phase 8 too).
- Cost-multiplier triangular parameters (0.85/1.0/1.2) are fixed constants,
  not yet exposed as a request input — a reasonable next increment if a real
  per-locomotive cost-variance need appears.
- Git: started this phase at 69 commits (post-Phase-7); Phase 8 added 13
  commits (spec, rng+test, distributions+test, statistics+test, engine+test,
  prisma schema, migration, service, routes+buildApp registration, openapi
  test update, routes integration test, this log entry, remaining doc
  updates) for a final total of 82+ on `feature/phase-8-simulation-engine`.

## 2026-10-12 — Post-audit hardening (Phase 9 follow-up)

Addressed four confirmed findings from the Phase 9 backend audit, as small
atomic commits (see `git log`):

- **`scenario.includeDowntime` wired into both engines.** Component already
  carried `mttrHours`/`downtimeCostPerDay` (captured at creation, unused
  since Phase 4). Added `(mttrHours / 24) * downtimeCostPerDay` per
  maintenance event, billed to the customer only, applied in
  `tco/engine.ts`, threaded through `tco/service.ts` and
  `simulation/engine.ts`/`simulation/service.ts` (simulation reuses the same
  `locomotiveTco()` call, so no duplicated logic). `laborRate`,
  `discountRate`, `inflationEnabled`, `fuelCostPerLiter` remain
  **intentionally** unapplied — see `TCO_ENGINE_SPECIFICATION.md`'s
  field-application table for why each one would require inventing data the
  domain model doesn't have (an hourly labor-hours field, a stored
  inflation/discount rate to compound, or a fuel-consumption model).
- **`SystemNode`/`Assembly` creation routes added.** `POST
  /locomotives/:id/systems` and `POST
  /locomotives/:id/systems/:systemId/assemblies` close the gap where a
  locomotive's BOM tree could only be built by seeding the database
  directly. Both verify organization ownership of every parent in the
  chain and reject cross-tenant references with 404.
- **Login/registration rate limiting added** via `@fastify/rate-limit`
  (10 requests/minute per client on `/auth/login` and `/auth/register`,
  registered `global: false` so no other route is throttled). Required a
  small fix to `errorHandler.ts`: it previously flattened every
  non-`AppError` exception to a generic 500, which silently turned the
  plugin's 429 into a 500. It now passes through a trusted plugin's own
  4xx `statusCode` and message instead.
- **Multi-org login: left as `memberships[0]`, not changed.** Audited
  every route that creates a `Membership` (`auth/service.ts` register,
  `users/routes.ts` POST `/users`) — neither one, nor any other code path
  in this repository, can ever attach a *second* membership to an existing
  user. A multi-org user is a state the Prisma schema permits but that no
  part of this application can currently produce. Building an
  organization-selection login flow for a state nothing can create would
  be inventing a requirement with no product spec behind it. This is
  recorded here as a known, backward-compatible simplification, not
  silently glossed over: if a future feature (e.g. inviting an existing
  user into a second organization) starts creating multi-membership users,
  `login`/`refresh` picking `memberships[0]` will need to become an
  explicit organization-selection step at that point.

**Validation results:** `tsc --noEmit` clean, `eslint .` clean, `vitest run`
82/82 (up from 72/72 at the start of this session), `tsc -p tsconfig.json`
(build) clean, `prisma validate` valid, `prisma migrate status` up to date.
No schema or migration changes were needed — `includeDowntime` and the new
routes only use fields and models that already existed.

**Remaining from the audit, not addressed in this pass:** `organizations`
and `fleets` modules still have no dedicated test file; the shared
`tenant-isolation.test.ts` still only checks registration-time org-ID
uniqueness rather than cross-org resource access for every module; no CI
pipeline exists; the frontend (`locomotive_wabtec-main`) still has zero
integration with this backend.
