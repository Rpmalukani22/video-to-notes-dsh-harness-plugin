import { AlignedContentBlock } from './TimestampAligner.js';
import { NoteSection, Citation } from '../entities/Note.js';
import { Timestamp } from '../value-objects/Timestamp.js';

/**
 * ContentAggregator - Domain service for streaming merge of OCR + transcript + scenes
 * Implements streaming aggregator to keep memory usage low
 */

export interface AggregationConfig {
  minSectionDurationMs: number;      // Minimum duration for a section
  maxSectionsPerScene: number;       // Max sections per scene
  mergeThresholdMs: number;          // Threshold to merge adjacent blocks
  includeVisualText: boolean;
  includeAudioText: boolean;
  includeCitations: boolean;
}

export class ContentAggregator {
  private readonly _config: AggregationConfig;
  private _currentSection: AggregatedSection | null = null;
  private _sections: AggregatedSection[] = [];

  constructor(config: Partial<AggregationConfig> = {}) {
    this._config = {
      minSectionDurationMs: 30000,      // 30 seconds minimum
      maxSectionsPerScene: 5,
      mergeThresholdMs: 5000,           // 5 seconds
      includeVisualText: true,
      includeAudioText: true,
      includeCitations: true,
      ...config
    };
  }

  /**
   * Process aligned content blocks in streaming fashion
   */
  processBlock(block: import('./TimestampAligner.js').AlignedContentBlock): void {
    const sceneId = block.scene?.id || 'no-scene';
    
    // Check if we need to start a new section
    if (this.shouldStartNewSection(block)) {
      this.finalizeCurrentSection();
      this.startNewSection(block);
    } else {
      this.addToCurrentSection(block);
    }
  }

  /**
   * Get all aggregated sections
   */
  getSections(): AggregatedSection[] {
    if (this._currentSection) {
      this.finalizeCurrentSection();
    }
    return this._sections;
  }

  /**
   * Convert to NoteSection format for rendering
   */
  toNoteSections(): NoteSection[] {
    return this.getSections().map(section => section.toNoteSection());
  }

  private shouldStartNewSection(block: import('./TimestampAligner.js').AlignedContentBlock): boolean {
    if (!this._currentSection) return true;

    // Check scene change
    if (this._currentSection.sceneId !== (block.scene?.id || 'no-scene')) {
      return true;
    }

    // Check duration threshold
    const duration = block.timestamp.milliseconds - this._currentSection.startTime;
    if (duration > this._config.minSectionDurationMs) {
      return true;
    }

    // Check section count per scene
    if (this._currentSection.blockCount >= 20) {
      return true;
    }

    return false;
  }

  private startNewSection(block: import('./TimestampAligner.js').AlignedContentBlock): void {
    this._currentSection = new AggregatedSection(
      block.scene?.id || 'no-scene',
      block.timestamp,
      block.scene?.type || 'unknown'
    );
    this.addToCurrentSection(block);
  }

  private addToCurrentSection(block: import('./TimestampAligner.js').AlignedContentBlock): void {
    if (!this._currentSection) {
      this.startNewSection(block);
      return;
    }

    this._currentSection.addBlock(block);
  }

  private finalizeCurrentSection(): void {
    if (!this._currentSection) return;

    // Only keep sections with meaningful content
    if (this._currentSection.hasContent) {
      this._sections.push(this._currentSection);
    }
    this._currentSection = null;
  }
}

/**
 * Aggregated section - intermediate representation during aggregation
 */
export class AggregatedSection {
  private readonly _sceneId: string;
  private readonly _sceneType: string;
  private readonly _startTime: number;
  private _endTime: number;
  private _blocks: import('./TimestampAligner.js').AlignedContentBlock[] = [];
  private _visualTexts: string[] = [];
  private _audioTexts: string[] = [];
  private _blockCount = 0;

  constructor(sceneId: string, startTimestamp: import('../value-objects/Timestamp.js').Timestamp, sceneType: string) {
    this._sceneId = sceneId;
    this._sceneType = sceneType;
    this._startTime = startTimestamp.milliseconds;
    this._endTime = startTimestamp.milliseconds;
  }

  get sceneId(): string {
    return this._sceneId;
  }

  get startTime(): number {
    return this._startTime;
  }

  get endTime(): number {
    return this._endTime;
  }

  get duration(): number {
    return this._endTime - this._startTime;
  }

  get blockCount(): number {
    return this._blockCount;
  }

  get hasContent(): boolean {
    return this._visualTexts.some(t => t.trim().length > 0) || 
           this._audioTexts.some(t => t.trim().length > 0);
  }

  addBlock(block: import('./TimestampAligner.js').AlignedContentBlock): void {
    this._blocks.push(block);
    this._blockCount++;
    this._endTime = block.timestamp.milliseconds;

    if (block.visualText) {
      this._visualTexts.push(block.visualText);
    }
    if (block.audioText) {
      this._audioTexts.push(block.audioText);
    }
  }

  getVisualText(): string {
    return this._visualTexts.join(' ').trim();
  }

  getAudioText(): string {
    return this._audioTexts.join(' ').trim();
  }

  getCombinedText(): string {
    const visual = this.getVisualText();
    const audio = this.getAudioText();
    return [visual, audio].filter(t => t.length > 0).join(' ');
  }

  getBlocks(): AlignedContentBlock[] {
    return [...this._blocks];
  }

  getStartTimestamp(): Timestamp {
    return Timestamp.fromMilliseconds(this._startTime);
  }

  getEndTimestamp(): Timestamp {
    return Timestamp.fromMilliseconds(this._endTime);
  }

  toNoteSection(): NoteSection {
    return {
      id: `section-${this._sceneId}-${this._startTime}`,
      title: this.generateTitle(),
      level: 2,
      timestamp: this.getStartTimestamp(),
      content: this.buildContent(),
      subsections: [],
      citations: this.buildCitations(),
      metadata: {
        sceneId: this._sceneId,
        sceneType: this._sceneType,
        blockCount: this._blockCount,
        durationMs: this.duration
      }
    };
  }

  private generateTitle(): string {
    const start = Timestamp.fromMilliseconds(this._startTime).toISO();
    const typeLabels: Record<string, string> = {
      'static-slide': 'Slide',
      'talking-head': 'Discussion',
      'code': 'Code Walkthrough',
      'action': 'Demonstration',
      'transition': 'Transition',
      'unknown': 'Section'
    };
    const label = typeLabels[this._sceneType] || 'Section';
    return `${label} (${start})`;
  }

  private buildContent(): string {
    const visual = this.getVisualText();
    const audio = this.getAudioText();
    
    let content = '';
    
    if (visual) {
      content += `**Visual Content:**\n${visual}\n\n`;
    }
    
    if (audio) {
      content += `**Transcript:**\n${audio}\n\n`;
    }
    
    return content.trim();
  }

  private buildCitations(): Citation[] {
    const citations: Citation[] = [];
    
    for (const block of this._blocks) {
      if (block.visualText) {
        citations.push({
          text: block.visualText.substring(0, 100),
          source: 'ocr',
          timestamp: block.timestamp.toISO(),
          frameId: block.frames[0]?.id,
          confidence: block.frames[0]?.getOCRConfidence() || 0
        });
      }
      
      for (const segment of block.transcriptSegments) {
        citations.push({
          text: segment.text.substring(0, 100),
          source: 'transcript',
          timestamp: segment.start.toISO(),
          segmentId: segment.id,
          confidence: segment.confidence.value
        });
      }
    }
    
    return citations;
  }
}