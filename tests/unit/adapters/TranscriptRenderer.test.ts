import { describe, it, expect } from 'vitest';
import { Transcript, TranscriptSegment } from '../../../src/domain/entities/Transcript.js';
import { Timestamp } from '../../../src/domain/value-objects/Timestamp.js';
import { Confidence } from '../../../src/domain/value-objects/Confidence.js';
import { TranscriptRenderer } from '../../../src/infrastructure/adapters/TranscriptRenderer.js';

describe('TranscriptRenderer', () => {
  it('renders empty transcript with informative header', () => {
    const renderer = new TranscriptRenderer();
    const transcript = new Transcript('v1', [], 'en', 'base.int8', 100);
    const md = renderer.renderToString(transcript);

    expect(md).toContain('# Transcript — v1');
    expect(md).toContain('No speech/transcript detected');
  });

  it('groups segments into readable paragraphs with timestamp headers', () => {
    const renderer = new TranscriptRenderer();
    const segments = [
      new TranscriptSegment(
        'seg-1',
        Timestamp.fromSeconds(0),
        Timestamp.fromSeconds(5),
        'Hello everyone and welcome.',
        new Confidence(0.95),
        [],
        'en',
        null
      ),
      new TranscriptSegment(
        'seg-2',
        Timestamp.fromSeconds(6),
        Timestamp.fromSeconds(12),
        'Today we are discussing clean architecture.',
        new Confidence(0.92),
        [],
        'en',
        null
      ),
    ];
    const transcript = new Transcript('v1', segments, 'en', 'base.int8', 200);
    const md = renderer.renderToString(transcript);

    expect(md).toContain('# Transcript — v1');
    expect(md).toContain('Hello everyone and welcome. Today we are discussing clean architecture.');
    expect(md).toContain('## [00:00:00.000]');
  });
});
