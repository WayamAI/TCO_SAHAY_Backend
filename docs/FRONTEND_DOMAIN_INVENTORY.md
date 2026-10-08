# Frontend Domain Inventory

Source: `../locomotive_wabtec-main` ("SAHAY" — locomotive fleet TCO platform).
Everything below is derived from the current Next.js frontend, which is
**100% client-side**: all data lives in static TS files under `src/data/*`,
state lives in two Zustand stores, and there is no API client anywhere
(`fetch`/`axios` greps return zero matches). This file is the backend's
contract against that reality — it records what exists today, not what the
backend should look like (see `CANONICAL_DOMAIN_MODEL.md` for that).

## Organizations / Users / Auth

- Source: `src/lib/auth.ts`, `src/components/auth/AuthGate.tsx`, `src/app/login/page.tsx`.
- Current behavior: `login(email, _password)` accepts any non-empty email —
  password is ignored. Session = `{email, loginAt}` in `localStorage` key
  `tco_auth_session`, no expiry, no server call, no cookies/JWT. Route
  protection is a client-side redirect in `AuthGate` (no `middleware.ts`).
  A custom `window` event `tco-auth-change` notifies listeners.
- Explicitly labeled in-code as a demo: "there is no real credential check."
- Backend implication: nothing here is reusable except the UX shape
  (email+password form → redirect to `/`). Real Organization/User/Membership/
  Role model must be built from scratch (Phase 3).

## Fleet / Asset hierarchy

- Source: `src/data/syntheticData.ts`.
- `Locomotive`: id, model, manufacturer, type, horsepower, purchaseCost,
  commissionYear, plannedLifeYears, currentAgeYears, annualKm/Hours, fuelType,
  fuel/energy cost fields, status, fleetCount, operatingProfile (FK),
  co2 factors, currentHealthScore, availabilityPct. 3 samples seeded
  (ES44AC diesel, FLXdrive battery-electric, AC4400CW legacy).
- `OperatingProfile`: id/name + multipliers (fuel, wear, maintenanceFreq,
  failureProb) + annualKm/Hours + description. 8 profiles: heavy-freight,
  passenger, yard-switching, metro, mining, mountain, desert, cold-climate.
- `SystemNode`: id, locomotiveId (FK), name, icon, criticality, healthScore.
  Locomotive 1:many SystemNode.
- `Assembly`: id, systemId (FK), name. SystemNode 1:many Assembly.
- `Component`: id, assemblyId (FK), name, purchaseCost, replacementCost,
  lifeYears, pmTrigger (months/km/hours), mtbfHours, weibullBeta/eta,
  mttrHours, warrantyYears, laborCostPct, consumable (nested), failureImpact,
  category, currentHours, rulYears/Confidence, downtimeCostPerDay,
  `dependsOn[]`/`affectsIfFails[]` (a component dependency graph), healthScore.
  Assembly 1:many Component.
- `MaintenanceSchedule`: id, locomotiveId (FK), name, trigger
  (months/km/hours), rule, laborHours, laborRatePerHour, partsEstimate,
  type (Preventive/Overhaul/Rebuild).
- Also in this file: `INFLATION_RATES`, `HISTORICAL_TCO[]`/`FORECAST_TCO[]`
  (year-by-year cost series with p10/p90 bands), `DOWNTIME_DATA`,
  `MONTE_CARLO_RESULTS` (static precomputed percentiles/histogram),
  `Competitor[]` (benchmarking), `RELIABILITY_CURVE_DATA` (generated Weibull
  curves per model), `Scenario[]` (8 predefined — see below),
  `SUSTAINABILITY_DATA`, `FINANCIAL_METRICS_BASELINE` (NPV/IRR/ROI/payback),
  `STANDARDS_COMPLIANCE`, `CHART_COLORS`, `healthColor()`.
- Backend scope now: Fleet, Locomotive, OperatingProfile, SystemNode,
  Assembly, Component (Phase 4); MaintenanceSchedule + a generic CostRecord
  ledger backing `HISTORICAL_TCO` (Phase 5).

## Component / Part / BOM

- Source: `src/data/bomData.ts` (5th hierarchy level: Locomotive → System →
  Assembly → Component → **Part**).
- `Part`: id, componentId (FK), name, partNumber, pnVerified, vendor,
  partClass, procurementType (new/reman/unit-exchange/consumable),
  repairable, qtyPerComponent, uom, unitPriceNew/Reman, coreCredit,
  scrapValue, lifeYears/Hours/Km, leadTimeWeeks, replacementIntervalYears,
  laborHoursPerReplacement, criticality (Vital/Essential/Desirable),
  failureImpact, vedClass (V/E/D), maintIntervalValue/Unit, maintQty,
  warrantyYears/Km, failureProbabilityPct, usefulLifeYears,
  depreciationMethod, capitalized, inventory fields (onHandQty,
  min/max/reorderPoint/safetyStock, annualUsageQty).
- ~50 part specs across 16 components; derivation helpers
  (`deriveInterval`, `deriveWarranty`, `deriveFailureProbability`,
  `withInventory`) compute defaults rather than requiring every field.
- `BOM_CONVENTIONS`: carrying cost %, labor rate, reman share %, core return
  window, fleet count.
- Backend scope: deferred to a future BOM/Vendors phase (Phase 10 in the
  master spec) — not in Phases 0–6, but the Part shape above is the target
  schema when that phase starts.

## TCO / Simulation / BOM calculation engines

- `src/utils/tcoEngine.ts` — part-level TCO math: `intervalYears`,
  `eventPartsCost`/`laborFor`/`eventTotalCost`, `companyBuffer` (expected
  warranty reserve = partsCost × failureProbabilityPct), `maintenanceEvents`
  (every occurrence up to a horizon, flags `underWarranty`), `partTCO`
  (aggregates into customerCost vs companyCost), `fleetTCO` (sums across
  parts), `failureTrend` (Weibull-shaped wear curve). Has an existing Vitest
  suite (`tcoEngine.test.ts`) — the backend port in Phase 6 must match it.
- `src/utils/simulationEngine.ts` — year-by-year fleet/component simulation:
  `weibullReliability`/`weibullFailureProb`, `inflatedCost`, `runTCOSimulation`
  (the core engine — preventive maintenance + component replacement +
  Weibull-driven failure cost + downtime cost, per year, with a
  customer-vs-organization TCO split). Deferred — this is Phase 7/8
  (scenario + simulation API), not Phase 6.
- `src/utils/bomEngine.ts` — depreciation (`netBookValue`,
  `depreciationSchedule`), `annualMaintenanceCost`, `lifecycleCost`,
  inventory (`carryingCost`, `inventoryTurns`, `stockStatus`), `abcClassify`
  (Pareto ABC). Deferred (Phase 10, BOM/Vendors).
- `src/utils/componentAnalytics.ts` — report/view-model functions
  (replacement/consumables/failure/downtime/warranty breakdowns) consumed by
  the Simulation Playground UI. These are computed response shapes, not
  persisted entities — useful as future API response references, not DB
  schema.

## Scenario

- Source: `Scenario` interface in `src/data/syntheticData.ts`,
  `src/store/simulationStore.ts`.
- Fields: id, name, color, planningHorizonYears, discountRate, laborRate,
  maintenanceIntervalMultiplier, failureRateMultiplier,
  warrantyExtendedYears, fuelCostPerLiter, inflationEnabled,
  includeDowntime, operatingProfile, precomputed `tco`. 8 predefined
  scenarios shipped as static data; `simulationStore` also holds up to 3
  "comparison scenarios" chosen at runtime.
- Backend scope: deferred to Phase 7 (Scenario as a persisted, org-scoped
  entity) — out of Phases 0–6.

## Integrations

- Source: `src/data/integrationsData.ts`. Catalog of 16 illustrative
  enterprise connectors (SAP S/4, Maximo, Wabtec FDMS, Railinc Umler, etc.)
  with field mappings, pipeline stages, and a "golden record" cross-reference
  example. This is reference material for a *future* real integrations
  module — it documents what a real connector's shape should look like, but
  nothing here is functional today and nothing here should be faked. Out of
  scope for Phases 0–6 (master spec Phase 12).

## Benchmarking / Sustainability / Reliability / Forecasting

- `Competitor[]`, `SUSTAINABILITY_DATA`, `RELIABILITY_CURVE_DATA`,
  `HISTORICAL_TCO`/`FORECAST_TCO` all live in `syntheticData.ts` as static
  arrays consumed directly by their respective pages
  (`/benchmark`, `/sustainability`, `/reliability`, `/forecasting`). All
  deferred past Phase 6 — no persisted entities for these yet, beyond the
  `CostRecord` ledger (Phase 5) which backs the historical/forecast chart's
  raw numbers.

## Routes (for reference — not all need a Phase 0–6 backend endpoint)

`/`, `/asset-health`, `/benchmark`, `/bom`, `/configure`, `/fleet-explorer`,
`/forecasting`, `/glossary`, `/integrations`, `/library`, `/login`,
`/maintenance`, `/monte-carlo`, `/reliability`, `/scenarios`, `/simulation`,
`/sustainability`, `/tender`. Each currently reads only from `src/data/*` /
the two Zustand stores — no route depends on a backend today, so there is no
risk of breaking existing functionality while the backend is built in
isolation.
