# Canonical Domain Model (Phases 0–6 scope)

```
Organization
 ├── Membership (userId, role) ── User
 └── Fleet
      └── Locomotive (Asset)
           ├── SystemNode
           │    └── Assembly
           │         └── Component
           ├── MaintenanceSchedule
           ├── CostRecord
           └── TcoRun

OperatingProfile  (org-scoped lookup, referenced by Locomotive)
```

## Organization

Tenant boundary. Owns every other row via `organizationId`. Purpose: isolate
one customer's fleet/cost data from another's.

## User / Membership

`User` is a login identity (email + passwordHash), global — a user *can*
belong to multiple organizations via `Membership`, but Phase 3 only needs to
support one org per user at signup; the model supports more without extra
work. `Membership.role` ∈ {ADMIN, MANAGER, ANALYST, VIEWER}. Lifecycle: users
are never hard-deleted (soft `deactivatedAt`), so audit history referencing
`createdBy`/`updatedBy` stays valid.

## Fleet

Org-scoped grouping of Locomotives (maps to the frontend's "Fleet Explorer").
No deep lifecycle of its own beyond create/rename/archive.

## OperatingProfile

Lookup table, org-scoped (an org can add custom profiles beyond the 8 seeded
ones). Referenced by Locomotive; drives multipliers used later by the TCO/
simulation engines (Phase 6+).

## Locomotive (the canonical "Asset")

Primary entity of the whole product. Fields mirror
`src/data/syntheticData.ts`'s `Locomotive` interface. Historical records are
required (purchase cost, commission year never change retroactively) so
updates to mutable fields (status, health score) should not destroy history —
Phase 5's `CostRecord` is the append-only ledger; the Locomotive row itself
holds current-state fields only.

## SystemNode → Assembly → Component

Three-level breakdown of a Locomotive's physical structure, 1:many at each
level, exactly as in the frontend. `Component` additionally carries
reliability parameters (MTBF, Weibull beta/eta, MTTR) and a self-referencing
dependency graph (`dependsOn`/`affectsIfFails`) modeled as a join table
`ComponentDependency(componentId, dependsOnComponentId)` rather than array
columns, so it can be queried relationally.

## MaintenanceSchedule

Belongs to a Locomotive. Defines *when* preventive maintenance should occur
(trigger by months/km/hours) and its estimated labor/parts cost — the plan,
not the record of what happened.

## CostRecord

Append-only ledger row: one Locomotive, one year, one category
(capex/maintenance/consumable/labor/failure/warranty/fuel/downtime), one
amount. Backs the `HISTORICAL_TCO` chart. This is the audit-friendly
historical-record entity the spec requires — never updated in place, only
inserted (corrections are new rows with a negative/adjustment amount).

## TcoRun

Output of Phase 6's TCO engine for one Locomotive (or an explicit Part list),
stored for reproducibility: inputs (horizonYears, laborPct, component/part
scope) + computed outputs (customerCost, organizationCost, breakdown JSON).
This is the one place a JSON column is justified — the breakdown shape is
genuinely variable (per-part/per-category rows) and is never queried by its
internal fields, only displayed back whole.

## Explicitly not modeled yet

`Part`/BOM, `Scenario`, `Vendor`, simulation runs, reliability/health scoring,
integrations, audit log — each belongs to a later phase (see
`FRONTEND_DOMAIN_INVENTORY.md` for where). Building their tables now would be
schema for capabilities with no endpoint and no caller.
