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
           ├── TcoRun
           └── SimulationRun

OperatingProfile  (org-scoped lookup, referenced by Locomotive and optionally by Scenario)
Scenario          (org-scoped, fleet-agnostic assumption bundle; TcoRun.scenarioId optionally references it)
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

## SimulationRun (Phase 8)

A separate table alongside `TcoRun`, not a replacement for it: `TcoRun` is
the deterministic baseline (one set of inputs -> one breakdown);
`SimulationRun` is the Monte Carlo distribution of `totalCost` across many
trials, each trial being a full re-run of the same canonical TCO engine with
a sampled failure-rate multiplier and cost multiplier (see
`SIMULATION_ENGINE_SPECIFICATION.md`). Stores `seed`, `iterations`,
`engineVersion`, a `config` input snapshot, and `summary`/`percentiles`/
`histogram` JSON outputs — never the raw per-trial values (hundreds of bytes
per run, not thousands of rows). Both a `TcoRun` and a `SimulationRun` can
exist independently for the same locomotive/scenario; a client wanting
"baseline vs spread" issues both calls.

## Scenario (Phase 7)

**Important finding from re-inspecting the frontend**: the SAHAY frontend's
Scenario feature (`src/data/syntheticData.ts`'s `Scenario` interface,
`simulationStore.ts`, `/scenarios` page) has no "apply a scenario" behavior
at all. `setActiveScenario()` is a pure label-setter never wired to
`setParams()`; the Scenario Comparator page renders static, hand-authored
`tco` numbers through a synthetic display curve, never calling the real
simulation engine. There is no create/edit/duplicate/delete UI, no
persistence, and no `locomotiveId` binding on a scenario — it's a flat,
fleet-agnostic parameter bundle that today exists only as 8 static display
cards. **This section is therefore new design, not a port** — per the
instruction to use the frontend as the source of truth for what exists, not
to invent behavior it doesn't have, this is called out explicitly rather
than presented as ported logic.

Fields carried over from the frontend's `Scenario` shape (same names, so a
future UI can map 1:1): `name`, `planningHorizonYears`,
`maintenanceIntervalMultiplier`, `failureRateMultiplier`,
`warrantyExtendedYears`, `operatingProfileId` (nullable FK — overrides the
locomotive's own profile for this run only). `discountRate`,
`fuelCostPerLiter`, `laborRate`, `inflationEnabled`, `includeDowntime` are
also stored (full frontend parity on the data shape) but **not yet applied**
by the TCO engine for the same reason the frontend never consumed some of
them either (`discountRate`/`fuelCostPerLiter` are dead fields there too) —
the others (`laborRate`, `inflationEnabled`, `includeDowntime`) would need
engine features (hourly labor rates, inflation modeling, downtime costing)
that don't exist yet. This is documented, not silently dropped — see
`TCO_ENGINE_SPECIFICATION.md`'s Scenario section.

Deliberately **not** created, because the frontend has no such concept and
nothing in the product requires it yet:
- `ScenarioAssumption` / `ScenarioInput` as separate tables — the fields
  above are a flat bundle in the frontend too; splitting them into child
  rows would be normalization the data doesn't call for.
- `ScenarioComparison` — comparing scenarios is purely "fetch N scenarios
  and N of their TCO runs, show side by side" on the client; there's no
  server-side comparison state to persist.
- `duplicate` as a distinct operation — a client can `POST` a copy of an
  existing scenario's fields; a dedicated endpoint would be a thin wrapper
  with no behavior of its own.

## TcoRun.scenarioId (extends Phase 6)

`TcoRun` gains a nullable `scenarioId` FK. Running `POST /tco/runs` with a
`scenarioId` applies that scenario's multipliers to each component before
computing (see `TCO_ENGINE_SPECIFICATION.md`), and overrides the horizon with
`scenario.planningHorizonYears` unless the caller passes an explicit
`horizonYears`. This satisfies the "don't duplicate TCO formulas in the
scenario module" requirement — the engine in `src/modules/tco/engine.ts`
remains the only place the math lives; the scenario module only transforms
inputs before calling it.

## Explicitly not modeled yet

`Part`/BOM, `Vendor`, Monte Carlo simulation runs, reliability/health
scoring, integrations, audit log — each belongs to a later phase (see
`FRONTEND_DOMAIN_INVENTORY.md` for where). Building their tables now would be
schema for capabilities with no endpoint and no caller.
