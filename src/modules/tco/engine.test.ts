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

  it('failureRateMultiplier scales the buffer (warranty reserve) linearly', () => {
    const base = componentTco(component, 20, { annualHours: 4500 });
    const doubled = componentTco(component, 20, { annualHours: 4500 }, 2);
    expect(doubled.buffer).toBeCloseTo(base.buffer * 2, 6);
    // Scaling the buffer must not change the maintenance-event math.
    expect(doubled.totalCost).toBe(base.totalCost);
  });

  // Regression guard for the documented gap in TCO_ENGINE_SPECIFICATION.md:
  // the frontend's Part-level engine treats warranty as whichever-first of
  // warrantyYears AND warrantyKm. Component has no warrantyKm field, so this
  // engine can only check years - meaning a high-mileage early failure that
  // would be past warranty by km (but not by year count) is still flagged
  // underWarranty: true here. This test pins that known behavior so a future
  // change to it (e.g. adding Part-level TCO) shows up as a deliberate diff.
  it('documents the known warranty-km gap: year-only warranty check', () => {
    const highMileageComponent = { ...component, warrantyYears: 10 };
    // 300,000 annual hours over 5 years is an implausibly high-mileage duty
    // cycle that would blow past any realistic warranty-km limit well before
    // year 5 - but this engine has no km field to check, so it stays "under
    // warranty" on years alone.
    const events = maintenanceEvents(highMileageComponent, 5);
    expect(events[0].underWarranty).toBe(true);
  });

  // Scenario.includeDowntime: Component already carries mttrHours and
  // downtimeCostPerDay (captured at creation, see assets/routes.ts) but the
  // engine ignored both until this test. Downtime cost per event is
  // (mttrHours / 24) * downtimeCostPerDay, always billed to the customer
  // (an outage is an operational cost regardless of who paid for the part).
  describe('includeDowntime', () => {
    const downtimeComponent = { ...component, mttrHours: 48, downtimeCostPerDay: 2000 };

    it('is zero cost when the flag is omitted or false', () => {
      const withoutFlag = componentTco(downtimeComponent, 20, { annualHours: 4500 });
      const explicitFalse = componentTco(downtimeComponent, 20, { annualHours: 4500 }, 1, false);
      expect(withoutFlag.downtimeCost).toBe(0);
      expect(explicitFalse.downtimeCost).toBe(0);
      expect(withoutFlag.totalCost).toBe(withoutFlag.maintenanceCost + withoutFlag.laborCost);
    });

    it('adds (mttrHours / 24) * downtimeCostPerDay per event when enabled', () => {
      const result = componentTco(downtimeComponent, 20, { annualHours: 4500 }, 1, true);
      // 4 events (years 5,10,15,20), each costing 48/24 * 2000 = 4000
      expect(result.downtimeCost).toBe(4 * 4000);
      expect(result.totalCost).toBe(result.maintenanceCost + result.laborCost + result.downtimeCost);
    });

    it('is always billed to the customer, never warranty-covered', () => {
      const result = componentTco(downtimeComponent, 20, { annualHours: 4500 }, 1, true);
      expect(result.customerCost).toBeGreaterThanOrEqual(result.downtimeCost);
      // Only the year-5 event is under warranty (warrantyYears: 7); downtime
      // cost must not appear in companyCost/warrantyCoveredCost.
      expect(result.warrantyCoveredCost).toBe(11800);
    });

    it('defaults mttrHours/downtimeCostPerDay to 0 when absent, even with the flag on', () => {
      const result = componentTco(component, 20, { annualHours: 4500 }, 1, true);
      expect(result.downtimeCost).toBe(0);
    });

    it('locomotiveTco passes includeDowntime through to every component', () => {
      const result = locomotiveTco([downtimeComponent], 20, { annualHours: 4500 }, 1, true);
      expect(result.rows[0].downtimeCost).toBe(4 * 4000);
    });
  });
});
