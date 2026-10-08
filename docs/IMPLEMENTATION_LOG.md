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

## Deliberate scope boundary

Scenario/simulation persistence, BOM/Parts/Vendors, forecasting/
benchmarking/sustainability, integrations, reporting, audit log, and any
frontend code change are explicitly out of scope for this pass — see
"Explicitly deferred" in `CANONICAL_DOMAIN_MODEL.md`. The frontend repository
was never modified; it was only read for domain discovery.

## Remaining issues / known gaps

- No CI pipeline configured yet — tests were run locally against a
  Homebrew-managed Postgres 14 instance.
- `prisma migrate dev` was used throughout (dev workflow); production should
  use `prisma migrate deploy` per `ARCHITECTURE_DECISIONS.md`.
- OpenAPI generation from the Zod schemas (`zod-to-json-schema` +
  `@fastify/swagger`) was planned in the architecture decision but not yet
  wired up — `API_CONTRACT.md` is currently hand-maintained prose, not a
  live spec.

## Next recommended atomic step

Wire up `@fastify/swagger` + `zod-to-json-schema` so `API_CONTRACT.md`
becomes a generated artifact rather than hand-maintained prose, as its own
small commit — then begin Phase 7 (Scenario as a persisted entity) only once
that's in place.
