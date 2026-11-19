import { describe, it, expect, beforeEach } from 'vitest';
import { ContentAggregator, AggregatedSection } from '../../../src/domain/services/ContentAggregator';
import { Timestamp } from '../../../src/domain/value-objects/Timestamp';
import { AlignedContentBlock } from '../../../src/domain/services/TimestampAligner';
import { Frame } from '../../../src/domain/entities/Frame';
import { TranscriptSegment } from '../../../src/domain/entities/Transcript';
import { Scene } from '../../../src/domain/entities/Scene';
import { Confidence } from '../../../src/domain/value-objects/Confidence';
import { WordTimestamp } from '../../../src/domain/entities/Transcript';
import { Timestamp as TimestampVO } from '../../../src/domain/value-objects/Timestamp';

describe('ContentAggregator', () => {
  let aggregator: ContentAggregator;

  beforeEach(() => {
    aggregator = new ContentAggregator({
      minSectionDurationMs: 30000,
      maxSectionsPerScene: 5,
      mergeThresholdMs: 5000
    });
  });

  describe('processBlock', () => {
    it('starts new section on first block', () => {
      const block = createTestBlock(TimestampVO.fromSeconds(10));
      aggregator.processBlock(block);
      
      const sections = aggregator.getSections();
      expect(sections.length).toBe(1);
      expect(sections[0].blockCount).toBe(1);
    });

    it('continues same section within duration threshold', () => {
      const block1 = createTestBlock(TimestampVO.fromSeconds(10));
      const block2 = createTestBlock(TimestampVO.fromSeconds(20));
      
      aggregator.processBlock(block1);
      aggregator.processBlock(block2);
      
      const sections = aggregator.getSections();
      expect(sections.length).toBe(1);
      expect(sections[0].blockCount).toBe(2);
    });

    it('starts new section when duration exceeds threshold', () => {
      const block1 = createTestBlock(TimestampVO.fromSeconds(10));
      const block2 = createTestBlock(TimestampVO.fromSeconds(40000)); // 40 seconds later
      
      aggregator.processBlock(block1);
      aggregator.processBlock(block2);
      
      const sections = aggregator.getSections();
      expect(sections.length).toBe(2);
    });

    it('starts new section on scene change', () => {
      const block1 = createTestBlock(TimestampVO.fromSeconds(10), 'scene1');
      const block2 = createTestBlock(TimestampVO.fromSeconds(110), 'scene2');

      aggregator.processBlock(block1);
      aggregator.processBlock(block2);

      const sections = aggregator.getSections();
      expect(sections.length).toBe(2);
      expect(sections[0].sceneId).toBe('scene1');
      expect(sections[1].sceneId).toBe('scene2');
    });

    it('aggregates visual and audio text', () => {
      const block = createTestBlock(
        TimestampVO.fromSeconds(10),
        'scene1',
        'Visual content from OCR',
        'Spoken transcript text'
      );
      
      aggregator.processBlock(block);
      
      const sections = aggregator.getSections();
      const section = sections[0];
      
      expect(section.getVisualText()).toBe('Visual content from OCR');
      expect(section.getAudioText()).toBe('Spoken transcript text');
    });
  });

  describe('toNoteSections', () => {
    it('converts aggregated sections to NoteSection format', () => {
      const block = createTestBlock(
        Timestamp.fromSeconds(10),
        'scene1',
        'Visual content',
        'Audio transcript'
      );
      
      aggregator.processBlock(block);
      const noteSections = aggregator.toNoteSections();
      
      expect(noteSections.length).toBe(1);
      const section = noteSections[0];
      expect(section.level).toBe(2);
      expect(section.content).toContain('Visual Content');
      expect(section.content).toContain('Transcript');
      expect(section.citations.length).toBeGreaterThan(0);
    });

    it('generates proper citations', () => {
      const frame = new Frame('f1', 'v1', Timestamp.fromSeconds(10), 10000);
      const block = createTestBlock(Timestamp.fromSeconds(10), 'scene1', 'Visual', 'Audio');
      
      // Add frame to block for citation
      const blockWithFrame = createTestBlockWithFrame(Timestamp.fromSeconds(10), 'scene1');
      
      aggregator.processBlock(blockWithFrame);
      const noteSections = aggregator.toNoteSections();
      
      const citations = noteSections[0].citations;
      expect(citations.length).toBeGreaterThan(0);
      expect(citations[0].source).toBeDefined();
      expect(citations[0].timestamp).toBeDefined();
    });
  });

  describe('streaming behavior', () => {
    it('processes blocks incrementally and finalizes the open section on read', () => {
      const block1 = createTestBlock(Timestamp.fromSeconds(10));
      aggregator.processBlock(block1);

      // Contract: getSections() closes the section that is still open, so a
      // pipeline that ends mid-stream never drops the final section.
      const sections1 = aggregator.getSections();
      expect(sections1.length).toBe(1);
      expect(sections1[0].blockCount).toBe(1);

      const block2 = createTestBlock(Timestamp.fromSeconds(40000)); // Forces a new section
      aggregator.processBlock(block2);

      const sections2 = aggregator.getSections();
      expect(sections2.length).toBe(2);
      expect(sections2[1].blockCount).toBe(1);
    });
  });
});

// Helper functions
function createTestBlock(
  timestamp: Timestamp,
  sceneId: string = 'scene1',
  visualText: string = 'Visual text',
  audioText: string = 'Audio text'
): AlignedContentBlock {
  // The scene is derived from the caller's sceneId so scene-change behaviour is
  // actually exercised by the tests.
  const scene = new Scene(sceneId, 'v1', Timestamp.fromSeconds(0), Timestamp.fromSeconds(100), 'static-slide');

  return {
    timestamp,
    scene,
    frames: [new Frame('f1', 'v1', timestamp, timestamp.milliseconds)],
    transcriptSegments: [new TranscriptSegment(
      'seg1',
      timestamp,
      timestamp.add(5000),
      audioText,
      new Confidence(0.9),
      [],
      'en'
    )],
    visualText,
    audioText,
    hasVisual: true,
    hasAudio: true,
    gap: false,
    gapDurationMs: 0
  };
}

function createTestBlockWithFrame(timestamp: Timestamp, sceneId: string): AlignedContentBlock {
  const frame = new Frame('f1', 'v1', timestamp, timestamp.milliseconds);
  frame.setOCRResult({
    lines: [],
    fullText: 'Visual text',
    averageConfidence: new Confidence(0.9),
    language: 'en',
    processingTimeMs: 100
  });

  return {
    timestamp,
    scene: new Scene(sceneId, 'v1', Timestamp.fromSeconds(0), Timestamp.fromSeconds(100), 'static-slide'),
    frames: [frame],
    transcriptSegments: [new TranscriptSegment(
      'seg1',
      timestamp,
      timestamp.add(5000),
      'Audio text',
      new Confidence(0.9),
      [],
      'en'
    )],
    visualText: 'Visual text',
    audioText: 'Audio text',
    hasVisual: true,
    hasAudio: true,
    gap: false,
    gapDurationMs: 0
  };
}