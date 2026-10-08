import { describe, expect, it } from 'vitest';
import {
  componentTco,
  laborFor,
  locomotiveTco,
  maintenanceEvents,
  weibullFailureProbability,
} from './engine.js';

const component = {
  id: 'c1',
  name: 'Traction Motor',
  replacementCost: 10000,
  lifeYears: 5,
  warrantyYears: 7,
  laborCostPct: 18,
  weibullBeta: 2,
  weibullEta: 50000,
};

describe('tco engine', () => {
  it('laborFor derives labor as a percentage of base cost', () => {
    expect(laborFor(10000, 18)).toBe(1800);
  });

  it('weibullFailureProbability is 0 at age 0 and increases monotonically', () => {
    expect(weibullFailureProbability(0, 2, 50000)).toBe(0);
    const a = weibullFailureProbability(10000, 2, 50000);
    const b = weibullFailureProbability(40000, 2, 50000);
    expect(b).toBeGreaterThan(a);
  });

  it('maintenanceEvents generates one event per lifeYears interval, flags warranty', () => {
    const events = maintenanceEvents(component, 20);
    // 5, 10, 15, 20 -> 4 events
    expect(events).toHaveLength(4);
    expect(events[0].atYear).toBe(5);
    expect(events[0].underWarranty).toBe(true); // 5 <= 7
  });

  it('warranty flag is false once atYear exceeds warrantyYears', () => {
    const events = maintenanceEvents(component, 20);
    expect(events[0].underWarranty).toBe(true); // year 5, warranty 7
    expect(events[1].underWarranty).toBe(false); // year 10 > warranty 7
  });

  it('componentTco splits customer vs company cost by warranty coverage', () => {
    const result = componentTco(component, 20, { annualHours: 4500 });
    // event at year 5: cost 10000 + 1800 labor = 11800, under warranty
    expect(result.warrantyCoveredCost).toBe(11800);
    expect(result.totalCost).toBe(4 * 11800);
    expect(result.customerCost).toBe(result.totalCost - result.warrantyCoveredCost);
    expect(result.companyCost).toBeGreaterThanOrEqual(result.warrantyCoveredCost);
  });

  it('locomotiveTco sums across components deterministically for the same input', () => {
    const a = locomotiveTco([component], 20, { annualHours: 4500 });
    const b = locomotiveTco([component], 20, { annualHours: 4500 });
    expect(a).toEqual(b);
    expect(a.customerTCO + a.warrantyCoveredCost).toBe(a.totalCost);
  });
});
