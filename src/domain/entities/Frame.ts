import { Timestamp } from '../value-objects/Timestamp.js';
import { Confidence } from '../value-objects/Confidence.js';
import { BoundingBox } from '../value-objects/BoundingBox.js';
import { OCRResult } from '../value-objects/OCRResult.js';

/**
 * Frame type classification
 */
export type FrameType = 
  | 'static-slide' 
  | 'talking-head' 
  | 'code' 
  | 'action' 
  | 'transition' 
  | 'unknown';

/**
 * Frame entity - represents a single extracted frame with OCR results
 */
export class Frame {
  private readonly _id: string;
  private readonly _videoId: string;
  private readonly _timestamp: Timestamp;
  private readonly _pts: number;              // FFmpeg presentation timestamp (master clock)
  private readonly _imagePath: string | null;  // Path to extracted frame image
  private readonly _imageData: Buffer | null;  // In-memory image data (for streaming)
  private _ocrResult: OCRResult | null;
  private _sceneId: string | null;
  private _type: FrameType;
  private _visualSummary: string | null;
  private _processedAt: Date | null;

  constructor(
    id: string,
    videoId: string,
    timestamp: Timestamp,
    pts: number,
    imagePath: string | null = null,
    imageData: Buffer | null = null
  ) {
    this._id = id;
    this._videoId = videoId;
    this._timestamp = timestamp;
    this._pts = pts;
    this._imagePath = imagePath;
    this._imageData = imageData;
    this._ocrResult = null;
    this._sceneId = null;
    this._type = 'unknown';
    this._visualSummary = null;
    this._processedAt = null;
  }

  get id(): string {
    return this._id;
  }

  get videoId(): string {
    return this._videoId;
  }

  get timestamp(): Timestamp {
    return this._timestamp;
  }

  get pts(): number {
    return this._pts;
  }

  get imagePath(): string | null {
    return this._imagePath;
  }

  get imageData(): Buffer | null {
    return this._imageData;
  }

  get ocrResult(): OCRResult | null {
    return this._ocrResult;
  }

  get sceneId(): string | null {
    return this._sceneId;
  }

  get type(): FrameType {
    return this._type;
  }

  get visualSummary(): string | null {
    return this._visualSummary;
  }

  get processedAt(): Date | null {
    return this._processedAt;
  }

  setOCRResult(result: OCRResult): void {
    this._ocrResult = result;
    this._processedAt = new Date();
  }

  setImagePath(imagePath: string): void {
    (this as unknown as { _imagePath: string | null })._imagePath = imagePath;
  }

  setSceneId(sceneId: string): void {
    this._sceneId = sceneId;
  }

  setType(type: FrameType): void {
    this._type = type;
  }

  setVisualSummary(summary: string): void {
    this._visualSummary = summary;
  }

  hasOCR(): boolean {
    return this._ocrResult !== null;
  }

  getText(): string {
    return this._ocrResult?.fullText || '';
  }

  getOCRConfidence(): number {
    return this._ocrResult?.averageConfidence.value || 0;
  }

  toJSON(): object {
    return {
      id: this._id,
      videoId: this._videoId,
      timestamp: this._timestamp.toISO(),
      pts: this._pts,
      imagePath: this._imagePath,
      ocrResult: this._ocrResult?.toJSON() || null,
      sceneId: this._sceneId,
      type: this._type,
      visualSummary: this._visualSummary,
      processedAt: this._processedAt?.toISOString() || null
    };
  }
}