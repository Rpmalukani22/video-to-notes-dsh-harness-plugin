import { describe, expect, it } from 'vitest';
import { selectTimelineScreenshots } from '../../../src/domain/services/ScreenshotSelector.js';
import { frameAt } from '../../helpers/fixtures.js';

describe('ScreenshotSelector (plan path)', () => {
  it('spreads screenshots over the full duration without repeats', () => {
    const frames = Array.from({ length: 120 }, (_, i) => frameAt(`f${i}`, i * 30000, `slide ${i}`));
    const picked = selectTimelineScreenshots(frames, { maxScreenshots: 12, durationMs: 3600000 });
    expect(picked).toHaveLength(12);
    expect(new Set(picked.map(f => f.id)).size).toBe(12);
    expect(picked[0]!.timestamp.milliseconds).toBeLessThan(180000);
    expect(picked.at(-1)!.timestamp.milliseconds).toBeGreaterThan(3420000);
  });
});
