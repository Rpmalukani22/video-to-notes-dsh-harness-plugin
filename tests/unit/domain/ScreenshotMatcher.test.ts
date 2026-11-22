import { describe, expect, it } from 'vitest';
import { matchScreenshots } from '../../../src/domain/services/ScreenshotMatcher.js';
import { Timestamp } from '../../../src/domain/value-objects/Timestamp.js';
import type { NoteSection } from '../../../src/domain/entities/Note.js';
import { frameAt } from '../../helpers/fixtures.js';

describe('ScreenshotMatcher (plan path)', () => {
  it('attaches the nearest screenshot and caps reuse at two', () => {
    const sections: NoteSection[] = [1, 2, 3].map(i => ({
      id: `s${i}`, title: `s${i}`, level: 2, timestamp: Timestamp.fromMilliseconds(i * 1000),
      content: '', subsections: [], citations: [], metadata: {},
    }));
    const frames = [frameAt('f1', 1000), frameAt('f2', 200000)];
    const paths = new Map([['f1', 'a.jpg'], ['f2', 'b.jpg']]);
    const result = matchScreenshots(sections, frames, paths);
    expect(result.get('s1')).toBe('a.jpg');
    expect(result.get('s2')).toBe('a.jpg');
    expect(result.get('s3')).toBeNull();
  });
});
