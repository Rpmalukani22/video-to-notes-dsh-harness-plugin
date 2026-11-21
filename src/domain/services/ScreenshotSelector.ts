import type { Frame } from '../entities/Frame.js';

const OCR_WEIGHT = 0.6;
const SCENE_BONUS = 20;
const DISTANCE_PENALTY = 0.1;
const DEFAULT_MAX = 20;

export interface ScreenshotSelectionOptions {
  maxScreenshots?: number;
  durationMs?: number | undefined;
}

/**
 * Pick at most `maxScreenshots` distinct frames, one per equal timeline bucket,
 * so the selection spans the full video rather than the first N minutes.
 */
export function selectTimelineScreenshots(
  frames: Frame[],
  options: ScreenshotSelectionOptions = {}
): Frame[] {
  if (frames.length === 0) return [];
  const sorted = [...frames].sort((a, b) => a.timestamp.milliseconds - b.timestamp.milliseconds);
  const max = clamp(options.maxScreenshots ?? DEFAULT_MAX, 1, sorted.length);
  const firstMs = sorted[0]!.timestamp.milliseconds;
  const lastMs = sorted[sorted.length - 1]!.timestamp.milliseconds;
  const span =
    options.durationMs !== undefined && options.durationMs > 0
      ? options.durationMs
      : Math.max(1, lastMs - firstMs);
  const used = new Set<string>();
  const selected: Frame[] = [];

  for (let bucket = 0; bucket < max; bucket++) {
    const lo = firstMs + (span * bucket) / max;
    const hi = firstMs + (span * (bucket + 1)) / max;
    const centerMs = (lo + hi) / 2;
    const score = (frame: Frame): number =>
      frame.getText().length * OCR_WEIGHT +
      (frame.sceneId ? SCENE_BONUS : 0) -
      (Math.abs(frame.timestamp.milliseconds - centerMs) / 1000) * DISTANCE_PENALTY;
    const inBucket = sorted.filter(
      frame =>
        frame.timestamp.milliseconds >= lo &&
        frame.timestamp.milliseconds < hi &&
        !used.has(frame.id)
    );
    const best =
      inBucket.length > 0
        ? [...inBucket].sort((a, b) => score(b) - score(a))[0]
        : nearestUnused(sorted, centerMs, used);
    if (best !== undefined && !used.has(best.id)) {
      used.add(best.id);
      selected.push(best);
    }
  }
  return selected.sort((a, b) => a.timestamp.milliseconds - b.timestamp.milliseconds);
}

function nearestUnused(frames: Frame[], centerMs: number, used: Set<string>): Frame | undefined {
  let best: Frame | undefined;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const frame of frames) {
    if (used.has(frame.id)) continue;
    const diff = Math.abs(frame.timestamp.milliseconds - centerMs);
    if (diff < bestDiff) {
      best = frame;
      bestDiff = diff;
    }
  }
  return best;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
