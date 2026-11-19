import { Timestamp } from '../value-objects/Timestamp.js';
import { Confidence } from '../value-objects/Confidence.js';

/**
 * Word-level timestamp from Whisper
 */
export interface WordTimestamp {
  word: string;
  start: Timestamp;
  end: Timestamp;
  confidence: Confidence;
}

/**
 * Transcript segment from Whisper
 */
export class TranscriptSegment {
  private readonly _id: string;
  private readonly _start: Timestamp;
  private readonly _end: Timestamp;
  private readonly _text: string;
  private readonly _confidence: Confidence;
  private readonly _words: WordTimestamp[];
  private readonly _language: string;
  private readonly _speakerId: string | null;

  constructor(
    id: string,
    start: Timestamp,
    end: Timestamp,
    text: string,
    confidence: Confidence,
    words: WordTimestamp[],
    language: string,
    speakerId: string | null = null
  ) {
    if (start.greaterThan(end)) {
      throw new Error('Segment start must be before end');
    }
    this._id = id;
    this._start = start;
    this._end = end;
    this._text = text;
    this._confidence = confidence;
    this._words = words;
    this._language = language;
    this._speakerId = speakerId;
  }

  get id(): string {
    return this._id;
  }

  get start(): Timestamp {
    return this._start;
  }

  get end(): Timestamp {
    return this._end;
  }

  get text(): string {
    return this._text;
  }

  get confidence(): Confidence {
    return this._confidence;
  }

  get words(): WordTimestamp[] {
    return this._words;
  }

  get language(): string {
    return this._language;
  }

  get speakerId(): string | null {
    return this._speakerId;
  }

  get duration(): number {
    return this._end.seconds - this._start.seconds;
  }

  containsTimestamp(ts: Timestamp): boolean {
    return !ts.lessThan(this._start) && !ts.greaterThan(this._end);
  }

  setSpeakerId(speakerId: string): void {
    // Note: This would need a mutable approach or reconstruction
    // For immutability, we'd create a new segment
  }

  toJSON(): object {
    return {
      id: this._id,
      start: this._start.toISO(),
      end: this._end.toISO(),
      text: this._text,
      confidence: this._confidence.toJSON(),
      words: this._words.map(w => ({
        word: w.word,
        start: w.start.toISO(),
        end: w.end.toISO(),
        confidence: w.confidence.toJSON()
      })),
      language: this._language,
      speakerId: this._speakerId
    };
  }
}

/**
 * Complete transcript entity
 */
export class Transcript {
  private readonly _id: string;
  private readonly _videoId: string;
  private readonly _segments: TranscriptSegment[];
  private readonly _language: string;
  private readonly _createdAt: Date;
  private readonly _processingTimeMs: number;
  private readonly _model: string;

  constructor(
    videoId: string,
    segments: TranscriptSegment[],
    language: string,
    model: string,
    processingTimeMs: number
  ) {
    this._id = crypto.randomUUID();
    this._videoId = videoId;
    this._segments = [...segments].sort((a, b) => a.start.seconds - b.start.seconds);
    this._language = language;
    this._model = model;
    this._processingTimeMs = processingTimeMs;
    this._createdAt = new Date();
  }

  get id(): string {
    return this._id;
  }

  get videoId(): string {
    return this._videoId;
  }

  get segments(): TranscriptSegment[] {
    return this._segments;
  }

  get language(): string {
    return this._language;
  }

  get model(): string {
    return this._model;
  }

  get processingTimeMs(): number {
    return this._processingTimeMs;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get segmentCount(): number {
    return this._segments.length;
  }

  get wordCount(): number {
    return this._segments.reduce((acc, s) => acc + s.words.length, 0);
  }

  get fullText(): string {
    return this._segments.map(s => s.text).join(' ');
  }

  getDuration(): number {
    if (this._segments.length === 0) return 0;
    const first = this._segments[0];
    const last = this._segments[this._segments.length - 1];
    // TypeScript knows these exist due to the length check above
    return (last!.end.seconds - first!.start.seconds);
  }

  getAverageConfidence(): number {
    if (this._segments.length === 0) return 0;
    const sum = this._segments.reduce((acc, s) => acc + s.confidence.value, 0);
    return sum / this._segments.length;
  }

  findSegmentsAtTimestamp(ts: Timestamp): TranscriptSegment[] {
    return this._segments.filter(s => s.containsTimestamp(ts));
  }

  findSegmentsInRange(start: Timestamp, end: Timestamp): TranscriptSegment[] {
    return this._segments.filter(s => 
      !s.end.lessThan(start) && !s.start.greaterThan(end)
    );
  }

  toJSON(): object {
    return {
      videoId: this._videoId,
      language: this._language,
      model: this._model,
      processingTimeMs: this._processingTimeMs,
      createdAt: this._createdAt.toISOString(),
      segments: this._segments.map(s => s.toJSON())
    };
  }
}