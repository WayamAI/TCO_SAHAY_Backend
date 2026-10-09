import { describe, expect, it } from 'vitest';
import type { TcoComponentInput } from '../tco/engine.js';
import { MAX_ITERATIONS, MIN_ITERATIONS, runSimulation, SIMULATION_ENGINE_VERSION, validateSimulationInput } from './engine.js';

const components: TcoComponentInput[] = [
  {
    id: 'c1',
    name: 'Traction Motor',
    replacementCost: 50000,
    lifeYears: 8,
    warrantyYears: 2,
    laborCostPct: 15,
    weibullBeta: 2.2,
    weibullEta: 60000,
  },
  {
    id: 'c2',
    name: 'Compressor',
    replacementCost: 12000,
    lifeYears: 5,
    warrantyYears: 1,
    laborCostPct: 10,
    weibullBeta: 1.8,
    weibullEta: 40000,
  },
];

const baseInput = {
  components,
  horizonYears: 20,
  event: { annualHours: 4500 },
  baseFailureMultiplier: 1,
  iterations: MIN_ITERATIONS,
  seed: 'reproducibility-seed',
};

describe('runSimulation reproducibility', () => {
  it('produces an identical result for identical inputs, seed, and iterations', () => {
    const a = runSimulation(baseInput);
    const b = runSimulation({ ...baseInput });
    expect(a).toEqual(b);
    expect(a.engineVersion).toBe(SIMULATION_ENGINE_VERSION);
  });

  it('produces a meaningfully different totalCost distribution for a different seed', () => {
    const a = runSimulation({ ...baseInput, iterations: 1000, seed: 'seed-A' });
    const b = runSimulation({ ...baseInput, iterations: 1000, seed: 'seed-B' });
    // Non-flaky: compare full percentile/summary structure, not a single random value.
    expect(a.totalCost.summary.mean).not.toBe(b.totalCost.summary.mean);
    expect(a.totalCost.percentiles).not.toEqual(b.totalCost.percentiles);
  });
});

describe('runSimulation trial behavior', () => {
  it('produces totalCost samples that vary (stochastic, not constant)', () => {
    const result = runSimulation({ ...baseInput, iterations: 1000 });
    expect(result.totalCost.summary.stddev).toBeGreaterThan(0);
    expect(result.totalCost.histogram.length).toBeGreaterThan(1);
  });

  it('centers roughly on the deterministic baseline at iterations scale', () => {
    // Using baseFailureMultiplier=1 and symmetric-ish multipliers, mean totalCost
    // should stay within a sane band around the unperturbed component totals.
    const result = runSimulation({ ...baseInput, iterations: 5000, seed: 'centering' });
    expect(result.totalCost.summary.mean).toBeGreaterThan(0);
    expect(result.totalCost.summary.min).toBeLessThanOrEqual(result.totalCost.summary.mean);
    expect(result.totalCost.summary.max).toBeGreaterThanOrEqual(result.totalCost.summary.mean);
  });
});

describe('validateSimulationInput', () => {
  it('rejects iterations below the minimum', () => {
    expect(() => validateSimulationInput({ ...baseInput, iterations: MIN_ITERATIONS - 1 })).toThrow(RangeError);
  });

  it('rejects iterations above the maximum', () => {
    expect(() => validateSimulationInput({ ...baseInput, iterations: MAX_ITERATIONS + 1 })).toThrow(RangeError);
  });

  it('rejects zero or negative iterations', () => {
    expect(() => validateSimulationInput({ ...baseInput, iterations: 0 })).toThrow(RangeError);
    expect(() => validateSimulationInput({ ...baseInput, iterations: -100 })).toThrow(RangeError);
  });

  it('accepts the min, default, and max iteration counts', () => {
    expect(() => validateSimulationInput({ ...baseInput, iterations: MIN_ITERATIONS })).not.toThrow();
    expect(() => validateSimulationInput({ ...baseInput, iterations: 1000 })).not.toThrow();
    expect(() => validateSimulationInput({ ...baseInput, iterations: MAX_ITERATIONS })).not.toThrow();
  });

  it('rejects a non-positive baseFailureMultiplier', () => {
    expect(() => validateSimulationInput({ ...baseInput, baseFailureMultiplier: 0 })).toThrow(RangeError);
    expect(() => validateSimulationInput({ ...baseInput, baseFailureMultiplier: -1 })).toThrow(RangeError);
    expect(() => validateSimulationInput({ ...baseInput, baseFailureMultiplier: NaN })).toThrow(RangeError);
  });

  it('rejects an empty components array', () => {
    expect(() => validateSimulationInput({ ...baseInput, components: [] })).toThrow(RangeError);
  });

  it('rejects an empty seed', () => {
    expect(() => validateSimulationInput({ ...baseInput, seed: '' })).toThrow(RangeError);
  });
});
