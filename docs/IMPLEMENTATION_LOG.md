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
