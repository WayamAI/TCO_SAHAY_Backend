// The only two probability distributions the simulation engine uses. See
// SIMULATION_ENGINE_SPECIFICATION.md "Distributions used" for rationale -
// no general-purpose distribution library is built here.
import type { Rng } from './rng.js';

/** Standard normal sample via Box-Muller, driven by the seeded RNG. */
export function sampleStandardNormal(rng: Rng): number {
  let u1 = rng();
  // avoid log(0)
  while (u1 === 0) u1 = rng();
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Lognormal sample with the given median and coefficient of variation.
 * Used for the failure-rate multiplier. `median` must be > 0.
 */
export function sampleLognormal(rng: Rng, median: number, coefficientOfVariation = 0.25): number {
  if (!(median > 0) || !isFinite(median)) {
    throw new RangeError(`sampleLognormal: median must be a positive finite number, got ${median}`);
  }
  if (!(coefficientOfVariation > 0)) {
    throw new RangeError('sampleLognormal: coefficientOfVariation must be > 0');
  }
  const sigma = Math.sqrt(Math.log(1 + coefficientOfVariation ** 2));
  const mu = Math.log(median) - sigma ** 2 / 2;
  return Math.exp(mu + sigma * sampleStandardNormal(rng));
}

/**
 * Triangular distribution sample via inverse CDF. Used for the cost
 * multiplier. Requires min <= mode <= max.
 */
export function sampleTriangular(rng: Rng, min: number, mode: number, max: number): number {
  if (!(min <= mode && mode <= max)) {
    throw new RangeError(`sampleTriangular: requires min <= mode <= max, got ${min}, ${mode}, ${max}`);
  }
  if (min === max) return min;
  const u = rng();
  const f = (mode - min) / (max - min);
  if (u < f) {
    return min + Math.sqrt(u * (max - min) * (mode - min));
  }
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}
