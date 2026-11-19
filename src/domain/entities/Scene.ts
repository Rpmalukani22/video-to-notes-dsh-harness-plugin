import { Timestamp } from '../value-objects/Timestamp.js';

/**
 * Scene type classification
 */
export type SceneType = 
  | 'static-slide' 
  | 'talking-head' 
  | 'code' 
  | 'action' 
  | 'transition' 
  | 'unknown';

/**
 * Scene entity - represents a continuous visual segment
 */
export class Scene {
  private readonly _id: string;
  private readonly _videoId: string;
  private readonly _start: Timestamp;
  private readonly _end: Timestamp;
  private _type: SceneType;
  private readonly _keyFrameIds: string[];
  private _visualSummary: string | null;
  private _confidence: number;
  private _keyFrames: Map<string, { timestamp: Timestamp; type: string }>;

  constructor(
    id: string,
    videoId: string,
    start: Timestamp,
    end: Timestamp,
    type: SceneType = 'unknown',
    keyFrameIds: string[] = []
  ) {
    if (start.greaterThan(end)) {
      throw new Error('Scene start must be before end');
    }
    this._id = id;
    this._videoId = videoId;
    this._start = start;
    this._end = end;
    this._type = type;
    this._keyFrameIds = [...keyFrameIds];
    this._visualSummary = null;
    this._confidence = 0;
    this._keyFrames = new Map();
  }

  get id(): string {
    return this._id;
  }

  get videoId(): string {
    return this._videoId;
  }

  get start(): Timestamp {
    return this._start;
  }

  get end(): Timestamp {
    return this._end;
  }

  get type(): SceneType {
    return this._type;
  }

  get keyFrameIds(): string[] {
    return this._keyFrameIds;
  }

  get visualSummary(): string | null {
    return this._visualSummary;
  }

  get confidence(): number {
    return this._confidence;
  }

  get duration(): number {
    return this._end.seconds - this._start.seconds;
  }

  get durationMs(): number {
    return this._end.milliseconds - this._start.milliseconds;
  }

  setType(type: SceneType): void {
    this._type = type;
  }

  setVisualSummary(summary: string): void {
    this._visualSummary = summary;
  }

  setConfidence(confidence: number): void {
    this._confidence = Math.max(0, Math.min(1, confidence));
  }

  addKeyFrame(frameId: string, timestamp: Timestamp, frameType: string = 'unknown'): void {
    if (!this._keyFrameIds.includes(frameId)) {
      this._keyFrameIds.push(frameId);
    }
    this._keyFrames.set(frameId, { timestamp, type: frameType });
  }

  getKeyFrames(): Array<{ id: string; timestamp: Timestamp; type: string }> {
    return Array.from(this._keyFrames.entries()).map(([id, data]) => ({
      id,
      ...data
    }));
  }

  containsTimestamp(ts: Timestamp): boolean {
    return !ts.lessThan(this._start) && !ts.greaterThan(this._end);
  }

  overlaps(other: Scene): boolean {
    return !this._end.lessThan(other._start) && !this._start.greaterThan(other._end);
  }

  toJSON(): object {
    return {
      id: this._id,
      videoId: this._videoId,
      start: this._start.toISO(),
      end: this._end.toISO(),
      type: this._type,
      keyFrameIds: this._keyFrameIds,
      visualSummary: this._visualSummary,
      confidence: this._confidence,
      duration: this.duration
    };
  }
}