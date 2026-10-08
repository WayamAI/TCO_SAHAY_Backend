// Canonical TCO engine — same math as the frontend's src/utils/tcoEngine.ts,
// adapted to run on Component (already modeled in Phase 4) rather than Part
// (BOM-level, deferred to a later phase). The three governing rules carry
// over unchanged:
//   1. Maintenance cost is component-specific: one replacement event every
//      `lifeYears`, never a locomotive-level lump sum.
//   2. Labor is never entered directly — it is laborCostPct of the
//      replacement cost on every event.
//   3. A replacement event inside the warranty window is paid by the
//      organization, not the customer.
//
// Failure probability (used for the organization's warranty reserve) comes
// from the component's own Weibull parameters rather than a stored
// `failureProbabilityPct` field, since Component has no such field —
// Part does, but Part is out of scope here.

export interface TcoComponentInput {
  id: string;
  name: string;
  replacementCost: number;
  lifeYears: number;
  warrantyYears: number;
  laborCostPct: number;
  weibullBeta: number;
  weibullEta: number;
}

export interface TcoEventInput {
  annualHours: number;
}

export interface MaintenanceEvent {
  occurrence: number;
  atYear: number;
  cost: number;
  laborCost: number;
  totalCost: number;
  underWarranty: boolean;
}

export function laborFor(baseCost: number, laborPct: number): number {
  return baseCost * (laborPct / 100);
}

/** Weibull cumulative failure probability at a given age in hours. */
export function weibullFailureProbability(ageHours: number, beta: number, eta: number): number {
  if (ageHours <= 0 || eta <= 0) return 0;
  return 1 - Math.exp(-Math.pow(ageHours / eta, beta));
}

/** Every replacement event for a component across the horizon. */
export function maintenanceEvents(
  component: TcoComponentInput,
  horizonYears: number,
): MaintenanceEvent[] {
  if (!isFinite(component.lifeYears) || component.lifeYears <= 0) return [];

  const events: MaintenanceEvent[] = [];
  const maxEvents = 400; // guard against a pathological sub-day interval
  for (let n = 1; n <= maxEvents; n++) {
    const atYear = component.lifeYears * n;
    if (atYear > horizonYears) break;

    const cost = component.replacementCost;
    const laborCost = laborFor(cost, component.laborCostPct);
    events.push({
      occurrence: n,
      atYear: +atYear.toFixed(2),
      cost,
      laborCost,
      totalCost: cost + laborCost,
      underWarranty: atYear <= component.warrantyYears,
    });
  }
  return events;
}

export interface ComponentTco {
  componentId: string;
  componentName: string;
  events: MaintenanceEvent[];
  eventCount: number;
  maintenanceCost: number;
  laborCost: number;
  totalCost: number;
  warrantyCoveredCost: number;
  customerCost: number;
  companyCost: number;
  buffer: number;
  avgAnnualCost: number;
}

export function componentTco(
  component: TcoComponentInput,
  horizonYears: number,
  input: TcoEventInput,
  failureRateMultiplier = 1,
): ComponentTco {
  const events = maintenanceEvents(component, horizonYears);

  let maintenanceCost = 0;
  let laborCost = 0;
  let warrantyCoveredCost = 0;
  for (const e of events) {
    maintenanceCost += e.cost;
    laborCost += e.laborCost;
    if (e.underWarranty) warrantyCoveredCost += e.totalCost;
  }

  const totalCost = maintenanceCost + laborCost;
  const ageHours = horizonYears * input.annualHours;
  const failureProbability =
    weibullFailureProbability(ageHours, component.weibullBeta, component.weibullEta) * failureRateMultiplier;
  const buffer = component.replacementCost * failureProbability;

  return {
    componentId: component.id,
    componentName: component.name,
    events,
    eventCount: events.length,
    maintenanceCost,
    laborCost,
    totalCost,
    warrantyCoveredCost,
    customerCost: totalCost - warrantyCoveredCost,
    companyCost: warrantyCoveredCost + buffer,
    buffer,
    avgAnnualCost: horizonYears > 0 ? totalCost / horizonYears : 0,
  };
}

export interface LocomotiveTco {
  rows: ComponentTco[];
  maintenanceCost: number;
  laborCost: number;
  totalCost: number;
  warrantyCoveredCost: number;
  customerTCO: number;
  organizationTCO: number;
  buffer: number;
  avgAnnualCost: number;
}

export function locomotiveTco(
  components: TcoComponentInput[],
  horizonYears: number,
  input: TcoEventInput,
  failureRateMultiplier = 1,
): LocomotiveTco {
  const rows = components.map((c) => componentTco(c, horizonYears, input, failureRateMultiplier));
  const sum = (pick: (r: ComponentTco) => number) => rows.reduce((s, r) => s + pick(r), 0);

  const totalCost = sum((r) => r.totalCost);
  const warrantyCoveredCost = sum((r) => r.warrantyCoveredCost);
  const buffer = sum((r) => r.buffer);

  return {
    rows,
    maintenanceCost: sum((r) => r.maintenanceCost),
    laborCost: sum((r) => r.laborCost),
    totalCost,
    warrantyCoveredCost,
    customerTCO: totalCost - warrantyCoveredCost,
    organizationTCO: warrantyCoveredCost + buffer,
    buffer,
    avgAnnualCost: horizonYears > 0 ? totalCost / horizonYears : 0,
  };
}
