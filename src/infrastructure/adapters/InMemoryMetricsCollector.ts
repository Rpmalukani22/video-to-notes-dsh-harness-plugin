import { IMetricsCollector, Timer } from '../../application/ports/Interfaces.js';

export interface MetricsSnapshot {
  counters: Record<string, number>;
  histograms: Record<string, { count: number; sum: number; min: number; max: number; avg: number }>;
  gauges: Record<string, number>;
}

/**
 * Dependency-free metrics collector. Holds aggregates in memory and exposes a
 * snapshot for reporting or tests.
 */
export class InMemoryMetricsCollector implements IMetricsCollector {
  private readonly _counters = new Map<string, number>();
  private readonly _histograms = new Map<string, { count: number; sum: number; min: number; max: number }>();
  private readonly _gauges = new Map<string, number>();

  incrementCounter(name: string, labels?: Record<string, string>): void {
    const key = metricKey(name, labels);
    this._counters.set(key, (this._counters.get(key) ?? 0) + 1);
  }

  recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = metricKey(name, labels);
    const current = this._histograms.get(key);
    if (!current) {
      this._histograms.set(key, { count: 1, sum: value, min: value, max: value });
      return;
    }
    current.count += 1;
    current.sum += value;
    current.min = Math.min(current.min, value);
    current.max = Math.max(current.max, value);
  }

  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    this._gauges.set(metricKey(name, labels), value);
  }

  startTimer(name: string, labels?: Record<string, string>): Timer {
    const startedAt = Date.now();
    return {
      stop: (extraLabels?: Record<string, string>): void => {
        const merged = { ...(labels ?? {}), ...(extraLabels ?? {}) };
        this.recordHistogram(name, Date.now() - startedAt, Object.keys(merged).length ? merged : undefined);
      },
    };
  }

  snapshot(): MetricsSnapshot {
    const histograms: MetricsSnapshot['histograms'] = {};
    for (const [key, value] of this._histograms) {
      histograms[key] = {
        count: value.count,
        sum: value.sum,
        min: value.min,
        max: value.max,
        avg: value.count === 0 ? 0 : value.sum / value.count,
      };
    }
    return {
      counters: Object.fromEntries(this._counters),
      histograms,
      gauges: Object.fromEntries(this._gauges),
    };
  }

  reset(): void {
    this._counters.clear();
    this._histograms.clear();
    this._gauges.clear();
  }
}

function metricKey(name: string, labels?: Record<string, string>): string {
  if (!labels) return name;
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  return parts.length === 0 ? name : `${name}{${parts.join(',')}}`;
}
