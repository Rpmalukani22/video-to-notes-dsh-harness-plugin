import { describe, it, expect } from 'vitest';
import { Frame } from '../../../src/domain/entities/Frame.js';
import { Timestamp } from '../../../src/domain/value-objects/Timestamp.js';
import { Confidence } from '../../../src/domain/value-objects/Confidence.js';
import { OCRResult } from '../../../src/domain/value-objects/OCRResult.js';
import { BoundingBox } from '../../../src/domain/value-objects/BoundingBox.js';
import { OCRRenderer } from '../../../src/infrastructure/adapters/OCRRenderer.js';

describe('OCRRenderer', () => {
  it('renders notice when no OCR text is found', () => {
    const renderer = new OCRRenderer();
    const md = renderer.renderToString([]);
    expect(md).toContain('No on-screen text was detected');
  });

  it('renders deduplicated OCR text blocks with slide headers and confidence', () => {
    const renderer = new OCRRenderer();

    const lines1 = [
      {
        text: 'Machine Learning 101',
        confidence: new Confidence(0.95),
        boundingBox: BoundingBox.fromCoordinates(0, 0, 100, 20),
        words: [],
      },
      {
        text: 'Supervised vs Unsupervised',
        confidence: new Confidence(0.9),
        boundingBox: BoundingBox.fromCoordinates(0, 30, 100, 50),
        words: [],
      },
    ];

    const frame1 = new Frame('f1', 'v1', Timestamp.fromSeconds(10), 10000);
    frame1.setOCRResult(new OCRResult(lines1, 'eng', 50));

    // Identical frame right after (should be deduplicated)
    const frame2 = new Frame('f2', 'v1', Timestamp.fromSeconds(12), 12000);
    frame2.setOCRResult(new OCRResult(lines1, 'eng', 50));

    const md = renderer.renderToString([frame1, frame2]);

    expect(md).toContain('Slide / Screen #1 @ 00:00:10.000');
    expect(md).toContain('Machine Learning 101');
    expect(md).not.toContain('Slide / Screen #2'); // Deduplicated!
  });
});
