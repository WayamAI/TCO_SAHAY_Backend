import { describe, expect, it } from 'vitest';
import { histogram, mean, percentile, percentiles, summarize, variance } from './statistics.js';

describe('mean/variance/percentile edge cases', () => {
  it('handles a single value', () => {
    expect(mean([5])).toBe(5);
    expect(variance([5])).toBe(0);
    expect(percentile([5], 90)).toBe(5);
  });

  it('handles identical values', () => {
    const v = [3, 3, 3, 3];
    expect(mean(v)).toBe(3);
    expect(variance(v)).toBe(0);
    expect(percentile(v, 50)).toBe(3);
  });

  it('does not mutate unsorted input when computing a percentile', () => {
    const v = [5, 1, 3, 2, 4];
    const copy = [...v];
    percentile(v, 50);
    expect(v).toEqual(copy);
  });

  it('computes a correct median for unsorted input', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
  });

  it('throws on empty input', () => {
    expect(() => mean([])).toThrow(RangeError);
    expect(() => variance([])).toThrow(RangeError);
    expect(() => percentile([], 50)).toThrow(RangeError);
  });

  it('rejects an out-of-range percentile', () => {
    expect(() => percentile([1, 2, 3], 101)).toThrow(RangeError);
    expect(() => percentile([1, 2, 3], -1)).toThrow(RangeError);
  });
});

describe('summarize', () => {
  it('returns consistent min/max/mean/median for a known set', () => {
    const s = summarize([1, 2, 3, 4, 5]);
    expect(s.mean).toBe(3);
    expect(s.median).toBe(3);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.variance).toBeCloseTo(2, 5);
    expect(s.stddev).toBeCloseTo(Math.sqrt(2), 5);
  });
});

describe('percentiles', () => {
  it('returns p10 <= p50 <= p90 <= p95', () => {
    const values = Array.from({ length: 1000 }, (_, i) => i);
    const p = percentiles(values);
    expect(p.p10).toBeLessThanOrEqual(p.p50);
    expect(p.p50).toBeLessThanOrEqual(p.p90);
    expect(p.p90).toBeLessThanOrEqual(p.p95);
  });
});

describe('histogram', () => {
  it('collapses to one bin when all values are identical', () => {
    const bins = histogram([7, 7, 7]);
    expect(bins).toHaveLength(1);
    expect(bins[0].count).toBe(3);
  });

  it('distributes values across bins and preserves total count', () => {
    const values = Array.from({ length: 500 }, (_, i) => i);
    const bins = histogram(values, 10);
    expect(bins).toHaveLength(10);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(500);
  });

  it('throws on empty input', () => {
    expect(() => histogram([])).toThrow(RangeError);
  });
});
