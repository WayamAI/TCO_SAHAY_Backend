# Architecture Decisions

## Language/runtime: Node.js + TypeScript

The frontend (SAHAY) is TypeScript/Next.js. Sharing the language lets domain
types and validation schemas be reused/mirrored later without a translation
layer, and keeps one toolchain for the team.

## Framework: Fastify (not Nest, not Express)

Nest's DI/module ceremony is scaffolding this project doesn't need yet — a
modular monolith with ~8 modules doesn't require it. Express lacks built-in
schema validation and is slower on cold JSON throughput. Fastify gives
first-class TS types, a request/response schema hook (used with Zod), and a
mature OpenAPI plugin, with less boilerplate than Nest.

## ORM/migrations: Prisma + PostgreSQL

Typed client matching the TS-first stack, first-class migrations, and
explicit relational modeling (the master spec forbids one giant table or
JSON-blob entities). PostgreSQL chosen per the spec's explicit preference and
because the domain (fleet/asset hierarchies, cost ledgers) is relational.

## Validation/OpenAPI: Zod

Validates both request input and response shape at the route boundary;
`zod-to-json-schema` feeds `@fastify/swagger` so `API_CONTRACT.md` stays a
living OpenAPI doc instead of hand-maintained prose.

## Auth: JWT access + rotated refresh token, argon2 password hashing

No OAuth — nothing in the product today requires a third-party identity
provider, and adding one now would be scaffolding for a requirement that
doesn't exist (YAGNI). Refresh tokens are stored hashed in `RefreshToken`
rows so a compromised token can be revoked without invalidating all sessions.

## Multi-tenancy: Organization → Membership → User, role-scoped

Matches the spec's mandated ADMIN/MANAGER/ANALYST/VIEWER roles. Every
tenant-owned table carries `organizationId` and all queries go through a
`tenantScope` middleware that injects it — this is what the mandatory
cross-tenant isolation tests (Phase 3 onward) verify.

## Testing: Vitest

Matches the frontend's existing test runner (`vitest.config.ts`,
`tcoEngine.test.ts` already exist there), keeping one mental model across
both repos for anyone working across them.

## Package manager: pnpm, single package

No monorepo/workspace split yet — there is exactly one deployable unit. A
split can be introduced later if a second service actually appears; building
workspace tooling for a project of one package today would be unused
structure.

## Deferred (not decided now, revisit when the need appears)

OAuth/SSO, message queue/event bus, microservice extraction, Redis cache,
Kubernetes — none of Phases 0–6 need them; adding them now would violate the
"no premature overengineering" rule in the master spec.
