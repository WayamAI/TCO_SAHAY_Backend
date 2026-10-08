# TCO Engine Specification

## Scope

This document specifies the backend's canonical TCO engine
(`src/modules/tco/engine.ts`) and, critically, its relationship to the
frontend's part-level engine (`locomotive_wabtec-main/src/utils/tcoEngine.ts`).
**Conclusion up front: the two are not mathematically equivalent.** The
backend currently operates one granularity level higher (Component instead
of Part) as a deliberate, documented interim abstraction — not an
oversight — pending the BOM/Parts phase. Where it diverges from the
frontend's actual numbers, this document names the gap precisely so no one
mistakes a `TcoRun` result for a drop-in replacement of the frontend's
part-level number today.

## Side-by-side comparison

| Dimension | Frontend (Part, `tcoEngine.ts`) | Backend (Component, `engine.ts`) | Equivalent? |
|---|---|---|---|
| **Input unit** | `Part` — ~50 parts across 16 components, several parts per component | `Component` — one row per component, no sub-parts | No — backend aggregates what the frontend treats as several independent maintenance streams into one |
| **Maintenance interval** | `maintIntervalValue` + `maintIntervalUnit` (hrs/km/months), converted via `intervalYears()` against a duty cycle (annualKm, annualHours) | `lifeYears` only — already in years, no unit conversion | Partial — backend has no hrs/km-driven interval; a part whose service life is governed by running hours (e.g. piston wear) is approximated as a fixed year count instead |
| **Event cost basis** | `eventPartsCost = maintQty × unitPriceNew` — quantity consumed per event may differ from `qtyPerComponent` (quantity installed) | `replacementCost` — one fixed cost per event, no qty/unit-price split | Partial — backend can't distinguish "replace 3 of 16 pistons" from "replace the whole component" |
| **Labor derivation** | `laborFor(eventPartsCost, laborPct)` — percentage of the part's own event cost | `laborFor(replacementCost, laborCostPct)` — percentage of the component's replacement cost, using the component's own stored `laborCostPct` rather than a global default | Yes, same formula shape — `cost × (pct/100)` — just applied to a coarser cost base |
| **Warranty window** | **Whichever-first** of `warrantyYears` AND `warrantyKm` — `underWarranty = withinYears && withinKm` | `warrantyYears` only — no km check (Component has no warranty-km field) | **No** — this is the clearest lossy gap. A part that's within its warranty year count but has exceeded warranty km (high-mileage early failure) would be incorrectly flagged `underWarranty: true` at component granularity |
| **Customer vs organization split** | `customerCost = totalCost − warrantyCoveredCost`; `companyCost = warrantyCoveredCost + buffer` | Identical formulas, same variable names/roles | Yes — the split *logic* is faithfully ported |
| **Warranty reserve ("buffer")** | `companyBuffer = eventPartsCost × failureProbabilityPct` — `failureProbabilityPct` is a stored, hand-calibrated field per part (derived from VED class + replacement interval at seed time, see `bomData.ts`'s `deriveFailureProbability`) | `buffer = replacementCost × weibullFailureProbability(ageHours, beta, eta)` — computed live from the component's own Weibull shape/scale parameters at the horizon's age in hours | **No** — different inputs, different formula shape, both legitimate but not interchangeable. The frontend's figure is a calibrated heuristic; the backend's is a first-principles reliability calculation. They will not produce the same number for the same part/component even in principle |
| **Expected life / horizon** | `horizonYears` passed uniformly through `maintenanceEvents`/`partTCO`/`fleetTCO` | Identical — `horizonYears` passed uniformly through `maintenanceEvents`/`componentTco`/`locomotiveTco` | Yes |
| **Annualization** | `avgAnnualCost = totalCost / horizonYears` | Identical formula | Yes |
| **Aggregation** | `fleetTCO(parts: Part[])` sums `partTCO` rows via `sum((r) => r.totalCost)` etc. — the part list can span multiple components/assemblies freely | `locomotiveTco(components: TcoComponentInput[])` sums `componentTco` rows the same way, scoped to one locomotive's full component tree | Yes, the reduce/sum *pattern* is identical; what's being summed is coarser |
| **Currency / rounding** | No rounding in the math (only `+atYear.toFixed(2)` for display); raw floats elsewhere | Identical — no rounding except `+atYear.toFixed(2)` | Yes |
| **Determinism** | Pure functions, no I/O or randomness | Pure functions, no I/O or randomness; backend additionally persists each run's inputs/outputs for reproducibility (`TcoRun`) | Yes, and the backend is strictly ahead here (reproducibility is stored) |

## Conclusion

Per the three candidate classifications:

1. ~~Mathematically equivalent aggregation~~ — **ruled out**. The warranty-km
   check and the failure-probability source are structurally different, not
   just re-scaled; no sum-of-components formula recovers the frontend's
   part-level number.
2. **Intentional domain abstraction** — yes, in the sense that
   `CANONICAL_DOMAIN_MODEL.md` explicitly deferred Part/BOM to a later phase
   and Component was chosen as the best available granularity meanwhile.
3. **Potentially lossy transformation** — also yes, and the losses are now
   enumerated above rather than implicit. The warranty-km gap in particular
   means a `TcoRun`'s `customerCost`/`companyCost` split can be *optimistic*
   (too much flagged as still-under-warranty) relative to what the frontend
   would show for the same fleet once Part data exists.

**Net: this is (2) and (3) together** — a deliberate interim abstraction
with a specific, bounded, documented lossiness, not a bug and not a
like-for-like port. Any consumer of `POST /tco/runs` today should treat the
result as "component-level TCO," not "the same number the SAHAY dashboard
shows." The fix is Phase 10 (BOM/Parts) extending this engine to operate on
Part rows directly (or a `partTco`/`fleetTco` pair alongside the existing
`componentTco`/`locomotiveTco`, reusing the same labor/warranty-split
pattern) — not a rewrite of what exists now.

## Tests added to prove the above, not disprove it

Since the two engines are *not* equivalent, no test asserts equal output.
Instead `src/modules/tco/engine.test.ts` gained a regression-guard test
(`documents the known warranty-km gap`) that pins today's behavior — a
component flagged `underWarranty: true` on years alone, with no km check
available — so that if/when a `warrantyKm` field is added to `Component`
(or Part-level TCO lands), that change is a deliberate, visible diff in this
test rather than a silent behavior shift.
