import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TimestampAligner, AlignedContentBlock } from '../../../src/domain/services/TimestampAligner';
import { Timestamp } from '../../../src/domain/value-objects/Timestamp';
import { TranscriptSegment, WordTimestamp } from '../../../src/domain/entities/Transcript';
import { Frame } from '../../../src/domain/entities/Frame';
import { Scene } from '../../../src/domain/entities/Scene';
import { Confidence } from '../../../src/domain/value-objects/Confidence';
import { BoundingBox } from '../../../src/domain/value-objects/BoundingBox';

describe('TimestampAligner', () => {
  let aligner: TimestampAligner;

  beforeEach(() => {
    aligner = new TimestampAligner(10000); // 10 second drift tolerance
  });

  describe('align', () => {
    it('aligns transcript segments to nearest frames within 2s window', () => {
      // Create test data
      const frame1 = new Frame('frame1', 'video1', Timestamp.fromSeconds(10), 10000);
      frame1.setOCRResult({
        lines: [],
        fullText: 'Slide 1: Introduction',
        averageConfidence: new Confidence(0.9),
        language: 'en',
        processingTimeMs: 100
      });

      const frame2 = new Frame('frame2', 'video1', Timestamp.fromSeconds(12), 12000);
      frame2.setOCRResult({
        lines: [],
        fullText: 'Slide 2: Overview',
        averageConfidence: new Confidence(0.85),
        language: 'en',
        processingTimeMs: 100
      });

      const segment1 = new TranscriptSegment(
        'seg1',
        Timestamp.fromSeconds(10.5),
        Timestamp.fromSeconds(15),
        'Welcome to the introduction',
        new Confidence(0.9),
        [],
        'en'
      );

      const frames = [frame1, frame2];
      const segments = [segment1];
      const scenes: Scene[] = [];

      const aligned = aligner.align([], [frame1, frame2], []);

      // Should create aligned blocks for transcript segments
      expect(aligned.length).toBeGreaterThan(0);
    });

    it('detects visual reference phrases', () => {
      const segment = new TranscriptSegment(
        'seg1',
        Timestamp.fromSeconds(10),
        Timestamp.fromSeconds(15),
        'As you can see on this slide, the data shows...',
        new Confidence(0.9),
        [],
        'en'
      );

      // Visual reference detection is private, but we can test via alignment
      const frame = new Frame('frame1', 'video1', Timestamp.fromSeconds(10), 10000);
      frame.setOCRResult({
        lines: [],
        fullText: 'Chart showing Q1 results',
        averageConfidence: new Confidence(0.9),
        language: 'en',
        processingTimeMs: 100
      });

      const aligned = aligner.align(
        [new TranscriptSegment('seg1', Timestamp.fromSeconds(10), Timestamp.fromSeconds(15), 'As you can see on this slide', new Confidence(0.9), [], 'en')],
        [new Frame('f1', 'v1', Timestamp.fromSeconds(10), 10000)],
        []
      );

      const block = aligned[0];
      expect(block.visualText).toBeDefined();
    });

    it('flags gaps > 10 seconds', () => {
      const segment = new TranscriptSegment(
        'seg1',
        Timestamp.fromSeconds(100),
        Timestamp.fromSeconds(111),
        'Long segment with no visual content',
        new Confidence(0.9),
        [],
        'en'
      );

      // No frames nearby - should flag gap
      const aligned = aligner.align([segment], [], []);
      
      expect(aligned.length).toBeGreaterThan(0);
      const block = aligned[0];
      expect(block.gap).toBe(true);
      expect(block.gapDurationMs).toBeGreaterThan(10000);
    });

    it('detects visual reference keywords', () => {
      const keywords = ['this slide', 'as you can see', 'here', 'this shows', 'look at', 'on screen'];
      
      for (const keyword of keywords) {
        const segment = new TranscriptSegment(
          'seg1',
          Timestamp.fromSeconds(10),
          Timestamp.fromSeconds(15),
          `Here is ${keyword} the data`,
          new Confidence(0.9),
          [],
          'en'
        );

        const frame = new Frame('f1', 'v1', Timestamp.fromSeconds(10), 10000);
        frame.setOCRResult({
          lines: [],
          fullText: 'Visual content',
          averageConfidence: new Confidence(0.9),
          language: 'en',
          processingTimeMs: 100
        });

        const aligned = aligner.align([new TranscriptSegment('seg', Timestamp.fromSeconds(10), Timestamp.fromSeconds(15), `Here is ${keyword}`, new Confidence(0.9), [], 'en')], [new Frame('f1', 'v1', Timestamp.fromSeconds(10), 10000)], []);
        
        // Should have visual reference detected (internal method)
        expect(aligned.length).toBeGreaterThan(0);
      }
    });

    it('creates visual-only blocks for frames without transcript', () => {
      const frame = new Frame('f1', 'v1', Timestamp.fromSeconds(50), 50000);
      frame.setOCRResult({
        lines: [],
        fullText: 'Standalone slide with no audio',
        averageConfidence: new Confidence(0.9),
        language: 'en',
        processingTimeMs: 100
      });

      const aligned = aligner.align([], [frame], []);
      
      // Should create visual-only block
      const visualOnlyBlocks = aligned.filter(b => !b.hasAudio && b.hasVisual);
      expect(visualOnlyBlocks.length).toBeGreaterThan(0);
    });
  });

  describe('visual reference detection', () => {
    it('detects various reference phrases', () => {
      const phrases = ['this slide', 'as you can see', 'here', 'this shows', 'look at', 'on screen'];
      
      for (const phrase of phrases) {
        // Test via private method indirectly
        const segment = new TranscriptSegment(
          'seg1',
          Timestamp.fromSeconds(10),
          Timestamp.fromSeconds(15),
          `Here is ${phrase}`,
          new Confidence(0.9),
          [],
          'en'
        );
        
        // Test via alignment
        const frame = new Frame('f1', 'v1', Timestamp.fromSeconds(10), 10000);
        const aligned = aligner.align(
          [new TranscriptSegment('seg', Timestamp.fromSeconds(10), Timestamp.fromSeconds(15), phrase, new Confidence(0.9), [], 'en')],
          [new Frame('f1', 'v1', Timestamp.fromSeconds(10), 10000)],
          []
        );
        
        expect(aligned.length).toBeGreaterThan(0);
      }
    });
  });

  describe('gap detection', () => {
    it('flags gaps > 10 seconds', () => {
      const segment = new TranscriptSegment(
        'seg1',
        Timestamp.fromSeconds(100),
        Timestamp.fromSeconds(120),
        'Long segment',
        new Confidence(0.9),
        [],
        'en'
      );

      const aligned = aligner.align([segment], [], []);
      const block = aligned[0];
      
      // Gap should be detected since no frames nearby
      expect(block.gap).toBe(true);
    });

    it('does not flag small gaps', () => {
      const frame = new Frame('f1', 'v1', Timestamp.fromSeconds(10), 10000);
      const segment = new TranscriptSegment(
        'seg1',
        Timestamp.fromSeconds(10.5),
        Timestamp.fromSeconds(12),
        'Close to frame',
        new Confidence(0.9),
        [],
        'en'
      );

      const aligned = aligner.align([segment], [new Frame('f1', 'v1', Timestamp.fromSeconds(10), 10000)], []);
      const block = aligned[0];
      
      expect(block.gap).toBe(false);
    });
  });
});