# Phase 9 — Integration Readiness Report

Audit date: 2026-10-09. Scope: backend repo `TCO_Backend` (branch `main`, commit `b1c475f` at audit start). Frontend repo `locomotive_wabtec-main` inspected read-only.

## 1. Repo / git state

- Backend path confirmed: `/Users/arkabera/Desktop/Wayam AI/Sahay/TCO_Backend`, `package.json` name `tco-backend`, Fastify/Prisma/Vitest stack — correct repo.
- Branch `main`, working tree clean at audit start.
- `git log --oneline -15` confirms merge commit `b1c475f` ("Merge feature/phase-8-simulation-engine") and the Phase 8 commit chain (RNG, distributions, engine, migration, service, routes, OpenAPI test, CRUD tests, docs).
- `git remote -v` returns nothing — **no `origin` remote is configured in this clone.** There is nothing to fetch from or push to, and no ahead/behind state exists to report. This is a pre-existing environment fact, not something this phase changed or attempted to fix.

## 2. Baseline validation (commands run, actual output)

| Check | Command | Result |
|---|---|---|
| Lint | `npx eslint .` | Exit 0, no output (clean) |
| Typecheck | `npx tsc --noEmit` | Exit 0, no output (clean) |
| Tests | `npx vitest run` | **15 test files passed, 72 tests passed**, 7.44s |
| Build | `npx tsc -p tsconfig.json` | Exit 0 (produces `dist/` via `tsc`, per `package.json` `build` script) |
| Prisma schema | `npx prisma validate` | "The schema at prisma/schema.prisma is valid" |
| Prisma migrations | `npx prisma migrate status` | Connected to live Postgres `tco_backend` on `localhost:5432`; "6 migrations found"; "Database schema is up to date!" |
| pnpm test | `pnpm test` | **Fails**: `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: @prisma/client@6.19.3, @prisma/engines@6.19.3, argon2@0.41.1, esbuild@0.21.5, esbuild@0.28.2, prisma@6.19.3` — `pnpm install` aborts before `pnpm test` can run vitest. |

**pnpm build-script gate finding:** pnpm 10's default supply-chain policy blocks lifecycle (`postinstall`) scripts for packages it hasn't been told to trust, unless `pnpm approve-builds` has been run in this environment. The blocked packages (`@prisma/client`, `prisma`, `argon2`, `esbuild`) are standard, well-known lifecycle scripts required by this exact stack (Prisma client generation, argon2 native binding compile, esbuild binary install) — not suspicious additions. `pnpm approve-builds` is pnpm's documented, correct resolution for a fresh clone, but it is an interactive command that mutates a local pnpm "approved builds" allowlist file; per the hard safety rules for this audit I did not run it blindly. **Recommendation:** a future, explicitly-authorized step should run `pnpm approve-builds` once (reviewing the picker) and commit the resulting `pnpm-workspace.yaml`/`.npmrc` allowlist entry if pnpm is meant to be the supported package manager; until then, `npx <script>` (bypassing pnpm's install gate entirely, using the already-installed `node_modules`) is the reliable path and is what this phase used throughout. This is a local tooling friction point, not a code defect.

## 3. API contract audit

See `docs/API_CONTRACT_AUDIT.md` for the full per-endpoint table (auth, organizations/users, fleets/locomotives, assets, costs, tco/runs, scenarios, simulation-runs) sourced from the live `/openapi.json` route (served via `@fastify/swagger`, verified by `src/app/openapi.test.ts`) cross-referenced against each module's `routes.ts`.

Headline finding: the OpenAPI spec and the route files are consistent — `openapi.test.ts` already asserts every route group appears in `spec.paths`, that `/fleets` requires `bearerAuth`, that `/tco/runs` POST documents request/response schemas, and that `/auth/register` documents a 409 and `/fleets/{fleetId}` documents a 404. No undocumented or orphaned routes were found during inspection.

## 4. Simulation contract (Phase 8)

See `docs/API_CONTRACT_AUDIT.md` §Simulation. Key confirmed facts (code-cited):

- `src/modules/simulation/engine.ts` line 4 imports `locomotiveTco` from `../tco/engine.js` and line 82 calls it per-trial — the simulation engine reuses the canonical TCO engine, it does not duplicate TCO math.
- Iteration bounds are constants: `MIN_ITERATIONS = 100`, `DEFAULT_ITERATIONS = 1000`, `MAX_ITERATIONS = 10000` (`engine.ts` lines 11-13), enforced both in `validateSimulationInput` and in the Zod route schema (`routes.ts` line 14) and again in `service.ts`.
- Cost-multiplier distribution is a fixed triangular (`min 0.85, mode 1.0, max 1.2`, `engine.ts` line 17) and failure-rate multiplier uses a fixed lognormal coefficient of variation `0.25` (line 18) — these are documented constants, not request inputs. Only `totalCost` is simulated; per-component or customer/org-level TCO distributions are not. This matches the known Phase 8 limitation and was **not** changed.
- Reproducibility and divergence are covered by existing tests in `src/modules/simulation/routes.test.ts`: `'is reproducible for the same seed and iterations'` (line 154) and `'generates a seed when none is supplied, and different runs get different seeds'` (line 175).
- Tenant isolation is enforced at the service layer (`service.ts`: every Prisma lookup is scoped by `organizationId`) and covered by `routes.test.ts` line 231 (`'enforces tenant isolation at the service/DB boundary'`).
- Persistence model: `SimulationRun` stores `config`/`summary`/`percentiles`/`histogram` as JSON columns — no raw per-trial data is persisted (confirmed by `prisma/schema.prisma` and `routes.ts` comment at line 21-23).

No code or business-formula changes were made to the simulation or TCO engines during this audit.

## 5. Frontend compatibility

See `docs/FRONTEND_BACKEND_COMPATIBILITY.md`. Headline finding: **the frontend currently has no real backend integration at all.** `src/lib/auth.ts` is explicitly commented "Demo authentication only — accepts any email/password combination. There is no real backend check." Data is sourced from static files under `src/data/` (`bomData.ts`, `syntheticData.ts`, `integrationsData.ts`). No `fetch(` calls, no `process.env`/`NEXT_PUBLIC_*` usage, no API client, and no `.env.example` were found anywhere under `src/` in the frontend repo. This is a static, code-level audit; no live frontend dev server was started against the backend, and that is called out explicitly rather than claimed as tested.

## 6. Auth / CORS / config

See `docs/ENVIRONMENT_CONFIGURATION.md`. CORS is handled by `@fastify/cors` (`src/app/buildApp.ts` line 27), configured from the `CORS_ORIGINS` env var (comma-split into an origin allowlist) — validated by `src/app/config.ts`'s Zod `envSchema`. All 6 required env vars already have a checked-in `.env.example` template with placeholder values.

## 7. Database / migration safety (static review; live DB was reachable)

A live Postgres instance (`tco_backend` on `localhost:5432`) was reachable during this audit, and `npx prisma migrate status` confirmed the 6 existing migrations are applied and the schema is up to date — this is a genuine live-DB check, not a fabricated one. Schema/migration file review (referential integrity, tenant columns, indexes) is folded into `docs/API_CONTRACT_AUDIT.md`'s simulation section and the existing `DATABASE_MODEL.md`; no destructive operation (reset, drop, migrate reset) was run, per the hard safety rules.

## 8. Remediation list (smallest safe next step per item)

| # | Finding | Smallest safe next step |
|---|---|---|
| 1 | No `origin` git remote configured | Out of scope for this audit; add a remote only when explicitly instructed with a real URL. |
| 2 | `pnpm test` blocked by `[ERR_PNPM_IGNORED_BUILDS]` | Run `pnpm approve-builds` interactively in a real dev setup, review the picker, commit the resulting allowlist; until then document `npx vitest run` as the supported local test command (done, in this report). |
| 3 | Frontend has zero real API integration (demo auth, static data) | Not a bug — it's the current, documented frontend state. Next phase should scope a minimal API client module (base URL + bearer token) and wire one read-only screen (e.g. fleet list) to the real `/fleets` endpoint as a proof of connectivity, rather than a full rewrite. |
| 4 | No `.env.example` in frontend repo | Out of scope (frontend is read-only for this audit); flag for the frontend team to add `NEXT_PUBLIC_API_BASE_URL` once real integration begins. |
| 5 | No live frontend+backend integration test run | Future phase: start backend against local Postgres + frontend dev server, verify one real round trip (e.g. login flow), with a live DB — mark current audit's frontend findings as static-only until then. |

No other code defects were found: lint, typecheck, build, test suite (72/72), and Prisma schema/migration status all pass as of this audit.
