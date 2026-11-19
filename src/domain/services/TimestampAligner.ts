import { Timestamp } from '../value-objects/Timestamp.js';
import { TranscriptSegment } from '../entities/Transcript.js';
import { Frame } from '../entities/Frame.js';
import { Scene } from '../entities/Scene.js';

/**
 * Aligned content block - combines visual and audio content at a timestamp
 */
export interface AlignedContentBlock {
  timestamp: Timestamp;
  scene: Scene | null;
  frames: Frame[];
  transcriptSegments: TranscriptSegment[];
  visualText: string;
  audioText: string;
  hasVisual: boolean;
  hasAudio: boolean;
  gap: boolean;              // True if only one modality has content
  gapDurationMs: number;     // Duration of gap in milliseconds
}

/**
 * TimestampAligner - Domain service for aligning visual and audio timestamps
 * Uses FFmpeg PTS (Presentation TimeStamp) as master clock
 */
export class TimestampAligner {
  private readonly _maxDriftToleranceMs: number;
  private readonly _visualReferenceKeywords: string[];
  private readonly _embeddingModel: EmbeddingProvider | null;

  constructor(
    maxDriftToleranceMs: number = 10000,  // 10 seconds default
    visualReferenceKeywords: string[] = ['this slide', 'as you can see', 'here', 'this shows', 'look at', 'on screen'],
    embeddingModel: EmbeddingProvider | null = null
  ) {
    this._maxDriftToleranceMs = maxDriftToleranceMs;
    this._visualReferenceKeywords = visualReferenceKeywords;
    this._embeddingModel = embeddingModel;
  }

  /**
   * Align transcript segments to nearest OCR frames using PTS master clock
   */
  align(
    transcriptSegments: TranscriptSegment[],
    frames: Frame[],
    scenes: Scene[]
  ): AlignedContentBlock[] {
    // Sort all by timestamp
    const sortedFrames = [...frames].sort((a, b) => a.timestamp.milliseconds - b.timestamp.milliseconds);
    const sortedSegments = [...transcriptSegments].sort((a, b) => a.start.milliseconds - b.start.milliseconds);
    const sortedScenes = [...scenes].sort((a, b) => a.start.milliseconds - b.end.milliseconds);

    const alignedBlocks: AlignedContentBlock[] = [];
    let frameIndex = 0;
    let sceneIndex = 0;

    for (const segment of sortedSegments) {
      // Find current scene
      let currentScene: Scene | null = null;
      while (sceneIndex < sortedScenes.length && sortedScenes[sceneIndex]?.end.lessThan(segment.start)) {
        sceneIndex++;
      }
      if (sceneIndex < sortedScenes.length) {
        const scene = sortedScenes[sceneIndex];
        if (scene && !scene.end.lessThan(segment.start)) {
          currentScene = scene;
        }
      }

      // Find frames within ±2s window of segment
      const windowStart = segment.start.milliseconds - 2000;
      const windowEnd = segment.end.milliseconds + 2000;

      const relevantFrames = frames.filter(f => 
        f.timestamp.milliseconds >= windowStart && f.timestamp.milliseconds <= windowEnd
      );

      // Find visual reference in transcript
      const visualRef = this.detectVisualReference(segment.text);

      // Get visual text from frames
      const visualText = this.extractVisualText(relevantFrames);

      // Check for gaps (>10s with single modality)
      const gapDurationMs = this.calculateGap(segment, relevantFrames);
      const hasGap = gapDurationMs > this._maxDriftToleranceMs;

      const alignedBlock: AlignedContentBlock = {
        timestamp: segment.start,
        scene: currentScene,
        frames: relevantFrames,
        transcriptSegments: [segment],
        visualText,
        audioText: segment.text,
        hasVisual: visualText.length > 0,
        hasAudio: segment.text.trim().length > 0,
        gap: hasGap,
        gapDurationMs
      };

      alignedBlocks.push(alignedBlock);
    }

    // Also create blocks for frames without transcript (visual-only)
    this.addVisualOnlyBlocks(alignedBlocks, frames);

    // Sort by timestamp
    return alignedBlocks.sort((a, b) => a.timestamp.milliseconds - b.timestamp.milliseconds);
  }

  /**
   * Detect visual reference phrases in transcript
   */
  private detectVisualReference(text: string): string | null {
    const lowerText = text.toLowerCase();
    for (const keyword of this._visualReferenceKeywords) {
      if (lowerText.includes(keyword)) {
        return keyword;
      }
    }
    return null;
  }

  /**
   * Extract visual text from frames
   */
  private extractVisualText(frames: Frame[]): string {
    return frames
      .filter(f => f.hasOCR())
      .map(f => f.getText())
      .join(' ')
      .trim();
  }

  /**
   * Calculate gap between visual and audio content
   */
  private calculateGap(segment: TranscriptSegment, frames: Frame[]): number {
    if (frames.length === 0) {
      return segment.duration * 1000; // Full segment duration as gap
    }

    // Find nearest frame to segment
    const segmentMid = segment.start.milliseconds + segment.duration * 500;
    let minDistance = Infinity;
    for (const frame of frames) {
      const distance = Math.abs(frame.timestamp.milliseconds - segmentMid);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
    return minDistance;
  }

  /**
   * Add visual-only blocks for frames without nearby transcript
   */
  private addVisualOnlyBlocks(alignedBlocks: AlignedContentBlock[], frames: Frame[]): void {
    for (const frame of frames) {
      const hasAudioNearby = alignedBlocks.some(block => 
        Math.abs(block.timestamp.milliseconds - frame.timestamp.milliseconds) < 5000
      );

      if (!hasAudioNearby && frame.hasOCR()) {
        alignedBlocks.push({
          timestamp: frame.timestamp,
          scene: null,
          frames: [frame],
          transcriptSegments: [],
          visualText: frame.getText(),
          audioText: '',
          hasVisual: true,
          hasAudio: false,
          gap: true,
          gapDurationMs: 0
        });
      }
    }
  }

  /**
   * Semantic matching using embeddings (if embedding model available)
   */
  async alignWithSemanticMatching(
    transcriptSegments: TranscriptSegment[],
    frames: Frame[]
  ): Promise<AlignedContentBlock[]> {
    if (!this._embeddingModel) {
      return this.align(transcriptSegments, frames, []);
    }

    // Get embeddings for transcript segments
    const segmentTexts = transcriptSegments.map(s => s.text);
    const segmentEmbeddings = await this._embeddingModel.embedBatch(segmentTexts);

    // Get embeddings for frame OCR text
    const frameTexts = frames.filter(f => f.hasOCR()).map(f => f.getText());
    const frameEmbeddings = await this._embeddingModel.embedBatch(frameTexts);

    // Compute similarity matrix and align
    // This is a simplified version - full implementation would use Hungarian algorithm
    // or similar for optimal matching
    return this.align(transcriptSegments, frames, []);
  }
}

/**
 * Embedding provider interface for semantic matching
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}