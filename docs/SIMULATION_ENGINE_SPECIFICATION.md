# Simulation Engine Specification (Phase 8)

## Purpose

The canonical TCO engine (Phase 4-7) produces a single deterministic number per
locomotive/scenario: "what does this cost if every component fails exactly on
its Weibull-implied schedule, at its listed replacement cost." Real fleets
don't behave that precisely — failure timing and part pricing vary. The
simulation engine runs the *same* canonical TCO engine many times with small,
justified random perturbations to two inputs, and reports the resulting
distribution (mean, percentiles, histogram) alongside the deterministic
baseline. It answers "how much could this vary," not "what is the true cost"
— the deterministic TcoRun remains the system of record for the latter.

The simulation engine never re-implements TCO math. It is a statistical
wrapper around `locomotiveTco()` (src/modules/tco/engine.ts).

## Inputs

| Name | Type | Source | Default | Units | Range | Deterministic/Stochastic | Rationale |
|---|---|---|---|---|---|---|---|
| `locomotiveId` | string | request body | — | — | must exist, owned by org | deterministic | identifies the asset to simulate |
| `scenarioId` | string? | request body | none | — | must exist, owned by org, if given | deterministic | optional scenario (same resolution as `POST /tco/runs`) |
| `horizonYears` | int | request body or scenario.planningHorizonYears | — | years | 1-100 | deterministic | same contract as TCO run |
| `iterations` | int | request body | 1000 | trials | 100-10000 | deterministic | see "Iteration limits" below |
| `seed` | string? | request body | generated | — | non-empty if supplied | deterministic | controls the entire stochastic sequence; see "Seed strategy" |
| failure-rate multiplier (per trial) | float | **derived**, not a direct request field | centered on `scenario.failureRateMultiplier ?? 1` | unitless multiplier on Weibull failure probability | > 0 | **stochastic** | failure timing in the field varies around the manufacturer/scenario estimate; modeled as lognormal because a failure-rate multiplier must stay positive and realistic variation is multiplicative, not additive |
| cost multiplier (per trial) | float | **derived**, not a direct request field | centered on 1.0 | unitless multiplier on every component's `replacementCost` | > 0 | **stochastic** | spare-part/vendor pricing varies trial to trial (market, logistics, currency); modeled as triangular (min/mode/max) because procurement teams reason in those terms and it naturally bounds the variation without a fat tail |

All other TCO inputs (component life, warranty years, labor %, Weibull
parameters, operating profile hours, scenario's `maintenanceIntervalMultiplier`
/ `warrantyExtendedYears`) are taken as-is from the resolved locomotive and
scenario, exactly as `runTco()` already resolves them. **No currently-unapplied
Scenario field (`laborRate`, `inflationEnabled`, `includeDowntime`,
`fuelCostPerLiter`) is newly applied here** — that would be an undocumented
product change outside this phase's scope.

### Why only two random variables

A general-purpose "sample everything" simulator would be easy to over-build
and hard to justify. Only failure timing and part cost variability have a
real-world mechanism and a real decision they inform (reserve sizing /
budgeting). Nothing else in the TCO formula is given a distribution.

## Distributions used

1. **Lognormal** (failure-rate multiplier): `exp(mu + sigma * Z)` where `Z` is
   standard normal (Box-Muller) and `mu, sigma` are chosen so the distribution
   has median `baseMultiplier` and a coefficient of variation of 0.25
   (`sigma = sqrt(ln(1 + 0.25^2))`, `mu = ln(baseMultiplier) - sigma^2/2`).
   Guarantees a strictly positive sample. `baseMultiplier` must be `> 0`.
2. **Triangular** (cost multiplier): `min = 0.85`, `mode = 1.0`, `max = 1.2`
   (fixed, asymmetric — procurement cost overruns are more common and larger
   than discounts). Standard inverse-CDF triangular sampling. Parameters are
   constants, not request inputs, because they model generic market
   variability, not a per-locomotive input Phase 8 has evidence for.

No other distribution (normal, Weibull-as-a-sampling-distribution, Poisson,
etc.) is implemented — none is used by a trial.

## Seed strategy

- `seed` is a string. If the caller supplies one, it is used verbatim
  (enables replay/debugging). If omitted, the service generates one via
  `crypto.randomBytes(16).toString('hex')`.
- The seed is hashed into a 32-bit integer (`xmur3`) and fed into a
  `mulberry32` PRNG — a small, fast, deterministic, seedable generator (no
  external dependency; `Math.random()` is never used inside the engine).
- One RNG instance is created per simulation run and consumed sequentially
  across all iterations and both distributions, so the full sequence is
  100% reproducible for a given `(seed, iterations, inputs, engineVersion)`.
- The seed, iteration count, and engine version are persisted on
  `SimulationRun`, so any run can be exactly replayed by re-invoking the
  engine with the same `(components, horizonYears, annualHours,
  baseFailureMultiplier, iterations, seed)` — this is asserted by a
  reproducibility test (see below).

## Output model

Per simulation run, for the primary metric `totalCost` (see "Why `totalCost`"
below):

- **Summary statistics**: `mean`, `median`, `min`, `max`, `stddev`,
  `variance`.
- **Percentiles**: `p10`, `p50`, `p90`, `p95` — the set a budgeting UI needs
  (median plus tail risk on both sides); no other percentiles are computed
  because nothing in the product brief asks for them.
- **Histogram**: 20 equal-width bins between the trial min and max, each with
  `{ rangeStart, rangeEnd, count }` — sufficient for a frontend bar/histogram
  chart without re-running the simulation.

### Why `totalCost`

`LocomotiveTco` already exposes several headline numbers
(`totalCost`, `customerTCO`, `organizationTCO`). Phase 8 simulates variability
in failure timing and part cost, both of which flow into `totalCost` (and
therefore into `customerTCO`/`organizationTCO`, which are a split of it). We
report the distribution of `totalCost` as the single primary metric to keep
the output model small and justified; `organizationTCO`'s warranty/buffer
split is a derived view a later phase can add as its own simulated series if a
real need arises.

## Not persisted: raw trials

A `SimulationRun` with `iterations = 10000` would mean 10,000 raw `totalCost`
values if persisted per-trial — no part of this product reads individual
trials, only the aggregate. We persist **config + summary + percentiles +
histogram** (a few hundred bytes), never the raw trial array. This is a
deliberate, reviewed decision, not an oversight.

## Traceability

Every `SimulationRun` row stores: `organizationId`, `locomotiveId`,
`scenarioId` (nullable), `horizonYears`, `iterations`, `seed`,
`engineVersion`, `createdByUserId`, `createdAt`, plus the full input snapshot
(`config` JSON: resolved annualHours, baseFailureMultiplier, component count,
distribution parameters) and output (`summary`, `percentiles`, `histogram`
JSON). This mirrors `TcoRun`'s `inputs`/`outputs` JSON-snapshot convention
(src/modules/tco/service.ts) so a run is fully reconstructable and auditable
without re-deriving anything from current, possibly-since-changed locomotive
state.

## `simulationEngineVersion`

A plain string constant, `SIMULATION_ENGINE_VERSION = '1.0.0'`, exported from
`src/modules/simulation/engine.ts` and persisted on every run as
`engineVersion`. It exists purely so a stored run can be matched against the
code that produced it (e.g. if distribution parameters change later, old runs
remain legible as "produced under 1.0.0"). It is a version string, not a
model registry — there is no versioned-engine-selection logic.

## Deterministic baseline stays distinct

`SimulationRun` is a new, separate table alongside `TcoRun`, not a
replacement. `POST /simulation-runs` does not create or require a `TcoRun`;
either can be run independently for the same locomotive/scenario. A client
wanting "baseline vs spread" issues both calls and shows them side by side.

## Numerical safety

Before persisting, the service rejects (throws `ValidationError`) if:
`iterations` is not an integer in `[100, 10000]`; the resolved
`baseFailureMultiplier` is not a finite number `> 0`; any computed summary
statistic is `NaN`, `Infinity`, or `-Infinity`; or the resolved locomotive has
zero components (nothing to simulate). The same finite-and-positive guard
already present in the canonical engine (`lifeYears <= 0` → no events) is
inherited unchanged per trial.

## Iteration limits

`min = 100`, `default = 1000`, `max = 10000`. See
"Performance / sync vs async" in IMPLEMENTATION_LOG.md Phase 8 entry for the
benchmark that justifies running synchronously within this range (no
queue/worker was added).
