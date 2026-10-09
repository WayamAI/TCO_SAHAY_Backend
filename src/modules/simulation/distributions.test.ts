import { describe, expect, it } from 'vitest';
import { createRng } from './rng.js';
import { sampleLognormal, sampleStandardNormal, sampleTriangular } from './distributions.js';

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

describe('sampleStandardNormal', () => {
  it('is deterministic for a given rng seed', () => {
    const a = Array.from({ length: 10 }, () => sampleStandardNormal(createRng('n-1')));
    const b = Array.from({ length: 10 }, () => sampleStandardNormal(createRng('n-1')));
    expect(a).toEqual(b);
  });

  it('has roughly zero mean over many samples', () => {
    const rng = createRng('n-mean');
    const samples = Array.from({ length: 20000 }, () => sampleStandardNormal(rng));
    expect(Math.abs(mean(samples))).toBeLessThan(0.05);
  });
});

describe('sampleLognormal', () => {
  it('always returns a positive finite number', () => {
    const rng = createRng('ln-1');
    for (let i = 0; i < 2000; i++) {
      const v = sampleLognormal(rng, 1.5);
      expect(v).toBeGreaterThan(0);
      expect(isFinite(v)).toBe(true);
    }
  });

  it('has a sample median close to the requested median over many trials', () => {
    const rng = createRng('ln-median');
    const samples = Array.from({ length: 20000 }, () => sampleLognormal(rng, 2));
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    expect(median).toBeGreaterThan(1.9);
    expect(median).toBeLessThan(2.1);
  });

  it('rejects a non-positive median', () => {
    const rng = createRng('ln-invalid');
    expect(() => sampleLognormal(rng, 0)).toThrow(RangeError);
    expect(() => sampleLognormal(rng, -1)).toThrow(RangeError);
    expect(() => sampleLognormal(rng, NaN)).toThrow(RangeError);
  });

  it('rejects a non-positive coefficient of variation', () => {
    const rng = createRng('ln-cov');
    expect(() => sampleLognormal(rng, 1, 0)).toThrow(RangeError);
    expect(() => sampleLognormal(rng, 1, -0.1)).toThrow(RangeError);
  });
});

describe('sampleTriangular', () => {
  it('always returns a value within [min, max]', () => {
    const rng = createRng('tri-1');
    for (let i = 0; i < 2000; i++) {
      const v = sampleTriangular(rng, 0.85, 1.0, 1.2);
      expect(v).toBeGreaterThanOrEqual(0.85);
      expect(v).toBeLessThanOrEqual(1.2);
    }
  });

  it('returns min when min === max', () => {
    const rng = createRng('tri-degenerate');
    expect(sampleTriangular(rng, 1, 1, 1)).toBe(1);
  });

  it('rejects out-of-order parameters', () => {
    const rng = createRng('tri-invalid');
    expect(() => sampleTriangular(rng, 1.2, 1.0, 0.85)).toThrow(RangeError);
  });
});
