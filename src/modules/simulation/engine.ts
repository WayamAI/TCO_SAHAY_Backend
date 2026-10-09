// Monte Carlo simulation engine. Reuses the canonical TCO engine
// (locomotiveTco) for every trial - no duplicate TCO math. See
// SIMULATION_ENGINE_SPECIFICATION.md for the full rationale.
import { locomotiveTco, type TcoComponentInput, type TcoEventInput } from '../tco/engine.js';
import { createRng } from './rng.js';
import { sampleLognormal, sampleTriangular } from './distributions.js';
import { histogram, percentiles, summarize, type HistogramBin, type Percentiles, type SummaryStats } from './statistics.js';

export const SIMULATION_ENGINE_VERSION = '1.0.0';

export const MIN_ITERATIONS = 100;
export const DEFAULT_ITERATIONS = 1000;
export const MAX_ITERATIONS = 10000;

// Fixed, documented triangular parameters for the cost multiplier - see
// spec's "Distributions used". Not request inputs.
const COST_MULTIPLIER_TRIANGULAR = { min: 0.85, mode: 1.0, max: 1.2 } as const;
const FAILURE_MULTIPLIER_COV = 0.25;

export interface SimulationInput {
  components: TcoComponentInput[];
  horizonYears: number;
  event: TcoEventInput;
  baseFailureMultiplier: number;
  iterations: number;
  seed: string;
}

export interface SimulationResult {
  totalCost: {
    summary: SummaryStats;
    percentiles: Percentiles;
    histogram: HistogramBin[];
  };
  engineVersion: string;
}

export function validateSimulationInput(input: SimulationInput): void {
  if (!Number.isInteger(input.iterations) || input.iterations < MIN_ITERATIONS || input.iterations > MAX_ITERATIONS) {
    throw new RangeError(
      `iterations must be an integer in [${MIN_ITERATIONS}, ${MAX_ITERATIONS}], got ${input.iterations}`,
    );
  }
  if (!isFinite(input.baseFailureMultiplier) || input.baseFailureMultiplier <= 0) {
    throw new RangeError(`baseFailureMultiplier must be a positive finite number, got ${input.baseFailureMultiplier}`);
  }
  if (input.components.length === 0) {
    throw new RangeError('components must not be empty - nothing to simulate');
  }
  if (!input.seed) {
    throw new RangeError('seed must be a non-empty string');
  }
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!isFinite(value) || value < 0) {
    throw new RangeError(`simulation produced an invalid ${label}: ${value}`);
  }
}

/** Runs `iterations` trials, each sampling fresh multipliers and re-running the canonical TCO engine. */
export function runSimulation(input: SimulationInput): SimulationResult {
  validateSimulationInput(input);

  const rng = createRng(input.seed);
  const totalCosts: number[] = [];

  for (let i = 0; i < input.iterations; i++) {
    const failureRateMultiplier = sampleLognormal(rng, input.baseFailureMultiplier, FAILURE_MULTIPLIER_COV);
    const costMultiplier = sampleTriangular(
      rng,
      COST_MULTIPLIER_TRIANGULAR.min,
      COST_MULTIPLIER_TRIANGULAR.mode,
      COST_MULTIPLIER_TRIANGULAR.max,
    );

    const perturbedComponents: TcoComponentInput[] = input.components.map((c) => ({
      ...c,
      replacementCost: c.replacementCost * costMultiplier,
    }));

    const trial = locomotiveTco(perturbedComponents, input.horizonYears, input.event, failureRateMultiplier);
    assertFiniteNonNegative(trial.totalCost, 'trial totalCost');
    totalCosts.push(trial.totalCost);
  }

  const summary = summarize(totalCosts);
  for (const [key, value] of Object.entries(summary)) {
    assertFiniteNonNegative(value, `summary.${key}`);
  }

  return {
    totalCost: {
      summary,
      percentiles: percentiles(totalCosts),
      histogram: histogram(totalCosts),
    },
    engineVersion: SIMULATION_ENGINE_VERSION,
  };
}
