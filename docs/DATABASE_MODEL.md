# Database Model (Phases 2–6 scope)

PostgreSQL via Prisma. Conventions applied to every table below unless noted:

- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `createdAt TIMESTAMPTZ DEFAULT now()`, `updatedAt TIMESTAMPTZ` (`@updatedAt`)
- tenant-owned tables carry `organizationId UUID NOT NULL` + an index on it
  (composite index with the next most-common filter column where relevant,
  e.g. `(organizationId, fleetId)` on `Locomotive`)
- foreign keys use `onDelete: Restrict` by default — nothing cascades
  silently; a Fleet with Locomotives can't be deleted until they're moved or
  archived. Exception: `ComponentDependency` cascades with its `Component`.

## Tables

**Organization** — `id`, `name`, `createdAt`, `updatedAt`. No
`organizationId` column on itself (it *is* the tenant).

**User** — `id`, `email UNIQUE`, `passwordHash`, `deactivatedAt NULL`,
`createdAt`, `updatedAt`. Not tenant-scoped (one user, many orgs via
Membership).

**Membership** — `id`, `userId FK→User`, `organizationId FK→Organization`,
`role ENUM(ADMIN,MANAGER,ANALYST,VIEWER)`, unique `(userId, organizationId)`.

**RefreshToken** — `id`, `userId FK→User`, `tokenHash`, `expiresAt`,
`revokedAt NULL`, `createdAt`. Indexed on `tokenHash`.

**Fleet** — `id`, `organizationId`, `name`, `archivedAt NULL`.

**OperatingProfile** — `id`, `organizationId NULL` (NULL = global seeded
profile, shared read-only across tenants), `name`, `fuelMultiplier`,
`wearMultiplier`, `maintenanceFreqMultiplier`, `failureProbMultiplier`,
`annualKm`, `annualHours`, `description`.

**Locomotive** — `id`, `organizationId`, `fleetId FK→Fleet`,
`operatingProfileId FK→OperatingProfile`, `model`, `manufacturer`, `type`,
`horsepower`, `purchaseCost`, `commissionYear`, `plannedLifeYears`,
`annualKm`, `annualHours`, `fuelType`, `fuelCostPerUnit`, `status`,
`currentHealthScore`, `availabilityPct`, `deletedAt NULL`.

**SystemNode** — `id`, `organizationId`, `locomotiveId FK→Locomotive`,
`name`, `icon`, `criticality`, `healthScore`.

**Assembly** — `id`, `organizationId`, `systemNodeId FK→SystemNode`, `name`.

**Component** — `id`, `organizationId`, `assemblyId FK→Assembly`, `name`,
`purchaseCost`, `replacementCost`, `lifeYears`, `pmTriggerMonths`,
`pmTriggerKm`, `pmTriggerHours`, `mtbfHours`, `weibullBeta`, `weibullEta`,
`mttrHours`, `warrantyYears`, `laborCostPct`, `failureImpact`, `category`,
`currentHours`, `downtimeCostPerDay`, `healthScore`, `deletedAt NULL`.

**ComponentDependency** — `id`, `componentId FK→Component`,
`dependsOnComponentId FK→Component`, unique `(componentId,
dependsOnComponentId)`. Models `dependsOn`/`affectsIfFails` relationally
instead of array columns, queryable in both directions.

**MaintenanceSchedule** — `id`, `organizationId`, `locomotiveId
FK→Locomotive`, `name`, `triggerMonths`, `triggerKm`, `triggerHours`, `rule`,
`laborHours`, `laborRatePerHour`, `partsEstimate`, `type
ENUM(PREVENTIVE,OVERHAUL,REBUILD)`.

**CostRecord** — `id`, `organizationId`, `locomotiveId FK→Locomotive`,
`year`, `category ENUM(CAPEX,MAINTENANCE,CONSUMABLE,LABOR,FAILURE,WARRANTY,
FUEL,DOWNTIME)`, `amount`, `createdAt`. No `updatedAt`/`deletedAt` — append
only, indexed on `(locomotiveId, year, category)`.

**TcoRun** — `id`, `organizationId`, `locomotiveId FK→Locomotive`,
`scenarioId FK→Scenario NULL`, `horizonYears`, `laborPct`, `inputs JSONB`,
`outputs JSONB`, `createdAt`, `createdByUserId FK→User`. `inputs`/`outputs`
are JSON because they're write-once, read-whole, never filtered by internal
field — the one place a JSON column is justified per the no-blob rule.
`scenarioId` is nullable because most runs (Phase 6) have no scenario.

**Scenario** — `id`, `organizationId`, `name`, `planningHorizonYears`,
`discountRate` (stored, not yet applied by the engine - see
`TCO_ENGINE_SPECIFICATION.md`), `laborRate` (stored, not yet applied),
`maintenanceIntervalMultiplier`, `failureRateMultiplier`,
`warrantyExtendedYears`, `fuelCostPerLiter` (stored, not yet applied),
`inflationEnabled` (stored, not yet applied), `includeDowntime` (stored, not
yet applied), `operatingProfileId FK→OperatingProfile NULL`, `createdAt`,
`updatedAt`. No `locomotiveId` — fleet-agnostic, matching the frontend's flat
`Scenario` shape exactly (see `CANONICAL_DOMAIN_MODEL.md`). No soft delete —
`TcoRun.scenarioId` uses `onDelete: SetNull`, so a scenario can be hard-
deleted even after it's been used; the `TcoRun` keeps its own copy of the
applied values in `inputs`, so history survives the scenario's deletion.

## Indexing summary

- Every FK column is indexed (Prisma does this by default for relations).
- `(organizationId, fleetId)` on Locomotive, `(organizationId, locomotiveId)`
  on SystemNode/MaintenanceSchedule/CostRecord/TcoRun — the common
  "list children of X within my org" query shape.
- `User.email` unique index (login lookup).
- `RefreshToken.tokenHash` unique index (refresh lookup/revocation).

## Migration strategy

One Prisma migration per schema-affecting commit (never bundle an unrelated
model change into the same migration as another). `prisma migrate dev` in
development, `prisma migrate deploy` in CI/production — never
`db push` outside local scratch work.
