// Aggregation helpers over an array of trial results. See
// SIMULATION_ENGINE_SPECIFICATION.md "Output model".

export interface SummaryStats {
  mean: number;
  median: number;
  min: number;
  max: number;
  stddev: number;
  variance: number;
}

export interface Percentiles {
  p10: number;
  p50: number;
  p90: number;
  p95: number;
}

export interface HistogramBin {
  rangeStart: number;
  rangeEnd: number;
  count: number;
}

function assertNonEmpty(values: number[], fn: string): void {
  if (values.length === 0) throw new RangeError(`${fn}: values must not be empty`);
}

export function mean(values: number[]): number {
  assertNonEmpty(values, 'mean');
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Linear-interpolated percentile (0-100) over a copy of `values` (does not mutate input). */
export function percentile(values: number[], p: number): number {
  assertNonEmpty(values, 'percentile');
  if (p < 0 || p > 100) throw new RangeError(`percentile: p must be in [0, 100], got ${p}`);
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function variance(values: number[]): number {
  assertNonEmpty(values, 'variance');
  if (values.length === 1) return 0;
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
}

export function summarize(values: number[]): SummaryStats {
  assertNonEmpty(values, 'summarize');
  const v = variance(values);
  return {
    mean: mean(values),
    median: percentile(values, 50),
    min: Math.min(...values),
    max: Math.max(...values),
    stddev: Math.sqrt(v),
    variance: v,
  };
}

export function percentiles(values: number[]): Percentiles {
  assertNonEmpty(values, 'percentiles');
  return {
    p10: percentile(values, 10),
    p50: percentile(values, 50),
    p90: percentile(values, 90),
    p95: percentile(values, 95),
  };
}

/** 20 equal-width bins between min and max. Degenerate (min === max) collapses to one bin. */
export function histogram(values: number[], binCount = 20): HistogramBin[] {
  assertNonEmpty(values, 'histogram');
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ rangeStart: min, rangeEnd: max, count: values.length }];
  }
  const width = (max - min) / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    rangeStart: min + i * width,
    rangeEnd: min + (i + 1) * width,
    count: 0,
  }));
  for (const v of values) {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / width));
    bins[idx].count++;
  }
  return bins;
}
