# Phase 9 — Frontend/Backend Compatibility Audit

Frontend repo inspected (read-only, no modifications made): `/Users/arkabera/Desktop/Wayam AI/Sahay/locomotive_wabtec-main` (Next.js app, `bun` package manager).

**This is a static, code-level audit only.** No live frontend dev server was started against the backend in this phase. Nothing below should be read as "it works end-to-end" — classifications marked "Not verified" mean exactly that.

## Method

Searched the frontend repo for: an API client/`lib` directory, `.env.example`, auth context/hooks, `fetch(` usage, `process.env`/`NEXT_PUBLIC_*` usage, and type definitions for TCO/Scenario/Simulation. Findings:

- `src/lib/auth.ts` — demo-only auth, explicitly commented: *"Demo authentication only — accepts any email/password combination. There is no real backend check; this exists purely to gate the UI behind a login screen for demo purposes."* It stores a session object in `localStorage` (`tco_auth_session`) with just `{ email, loginAt }`. No JWT, no token, no network call.
- No file anywhere under `src/` calls `fetch(`.
- No `process.env` or `NEXT_PUBLIC_*` reference exists anywhere under `src/`.
- No `.env.example` file exists in the frontend repo root.
- `src/data/bomData.ts`, `src/data/syntheticData.ts`, `src/data/integrationsData.ts` — static, hardcoded data modules. These are the frontend's entire current data source.
- No `api/` client directory, no OpenAPI-generated types, no Scenario/Simulation/TCO TypeScript interfaces matching the backend's shapes were found.

## Compatibility classification

| Frontend concept | Backend reality | Classification |
|---|---|---|
| Auth / token handling | Backend: JWT access+refresh via `/auth/*` (bearer scheme, `src/app/buildApp.ts`). Frontend: `localStorage`-only demo session, no token at all. | **Missing frontend functionality** — frontend has no real auth client to connect to the backend's JWT flow. |
| API base URL + version prefix | Backend serves routes at root (e.g. `/fleets`, `/simulation-runs`) with no `/api/v1` prefix in the route registrations seen (test requests in `routes.test.ts` use `/api/v1/...`, implying a prefix is applied at `buildApp`/plugin-registration level — confirms versioning exists server-side). Frontend: no concept of a base URL at all (no env var, no client). | **Missing frontend functionality.** |
| TCO run creation/result rendering | Backend: `POST /tco/runs` returns `{ data: TcoRun }` with `inputs`/`outputs` JSON. Frontend: no TCO-run UI wired to any endpoint found. | **Missing frontend functionality** (frontend may have TCO-shaped mock UI driven by `syntheticData.ts`, but not connected). |
| Scenario CRUD | Backend: full CRUD at `/scenarios`. Frontend: no scenario API calls found. | **Missing frontend functionality.** |
| Monte Carlo request/response shape + visualization | Backend: `POST /simulation-runs` returns summary/percentiles/histogram JSON (see `API_CONTRACT_AUDIT.md`). Frontend: no simulation API calls found; any Monte Carlo-looking UI is presumably static/synthetic. | **Missing frontend functionality.** |
| Error/loading state handling | Backend returns structured `errorResponse` envelopes (404/400/409/403). Frontend has no fetch layer, so no error/loading states tied to real requests exist. | **Missing frontend functionality.** |
| CORS | Backend: `@fastify/cors` configured from `CORS_ORIGINS` env (`src/app/config.ts`, `.env.example` default `http://localhost:3000`) — already matches Next.js's default dev port. | **Deployment-configuration dependency** — compatible by default for local dev, but `CORS_ORIGINS` must be set to match wherever the frontend is actually deployed. |
| Pagination/filtering | Not inspected in depth on backend list routes (out of scope detail); frontend has no list-fetching code to compare against. | **Not verified.** |
| Synthetic/mock data markers | Frontend's `src/data/*.ts` files are clearly named as data fixtures, not disguised as real data — no deceptive mock markers. | **Compatible** (by omission — nothing to reconcile yet). |
| Endpoints frontend calls that backend doesn't implement, or vice versa | Frontend calls **no** backend endpoints currently, so there are no mismatched calls — the entire backend API surface is simply unused by the frontend today. | **Missing frontend functionality** (backend is strictly ahead). |

## Summary

The backend (Phases 1-8) has a complete, tested, OpenAPI-documented API surface for auth, orgs/users, fleets, assets, costs, TCO runs, scenarios, and Monte Carlo simulation runs. The frontend, as it currently exists in this repo snapshot, has **no real integration with any backend at all** — it is a standalone demo UI with localStorage-based fake auth and static fixture data. There are therefore no "contract mismatches" in the sense of frontend code calling the wrong shape — there is simply no frontend API client to mismatch yet.

This is not a backend defect. It means Phase 9's "frontend integration blockers" are really "frontend integration has not started," and the next phase's smallest safe step is scoped accordingly below.

## Recommended smallest next step (not implemented in this audit — scope is audit-only)

1. Add a minimal typed API client module to the frontend (base URL from a new `NEXT_PUBLIC_API_BASE_URL` env var + bearer token storage), wire the existing login screen to `POST /auth/login` instead of the demo `auth.ts`, and connect one read-only screen (e.g. fleet/locomotive list) to `GET /fleets` as a proof of connectivity — before attempting TCO/Scenario/Simulation wiring.
2. Add `.env.example` to the frontend repo documenting `NEXT_PUBLIC_API_BASE_URL` (this audit did not create it, since the frontend repo must not be modified here).
