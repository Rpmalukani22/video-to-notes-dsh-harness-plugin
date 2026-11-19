import { Video } from '../entities/Video.js';
import { Frame } from '../entities/Frame.js';
import { Transcript } from '../entities/Transcript.js';
import { Scene } from '../entities/Scene.js';
import { Note } from '../entities/Note.js';
import { Timestamp } from '../value-objects/Timestamp.js';

/**
 * Base domain event interface
 */
export interface DomainEvent {
  eventId: string;
  eventType: string;
  eventTimestamp: Date;
  correlationId: string;
  videoId: string;
}

/**
 * Domain events for video processing pipeline
 */

export class VideoProcessingStarted implements DomainEvent {
  eventId: string;
  eventType = 'VideoProcessingStarted';
  eventTimestamp: Date;
  correlationId: string;
  videoId: string;
  config: object;

  constructor(correlationId: string, video: Video, config: object) {
    this.eventId = crypto.randomUUID();
    this.eventTimestamp = new Date();
    this.correlationId = correlationId;
    this.videoId = video.id;
    this.config = config;
  }
}

export class FrameExtracted implements DomainEvent {
  eventId: string;
  eventType = 'FrameExtracted';
  eventTimestamp: Date;
  correlationId: string;
  videoId: string;
  frameId: string;
  frameTimestamp: Timestamp;
  sceneId: string | null;

  constructor(correlationId: string, frame: Frame, sceneId: string | null) {
    this.eventId = crypto.randomUUID();
    this.eventTimestamp = new Date();
    this.correlationId = correlationId;
    this.videoId = frame.videoId;
    this.frameId = frame.id;
    this.frameTimestamp = frame.timestamp;
    this.sceneId = sceneId;
  }
}

export class OCRCompleted implements DomainEvent {
  eventId: string;
  eventType = 'OCRCompleted';
  eventTimestamp: Date;
  correlationId: string;
  videoId: string;
  frameId: string;
  textLength: number;
  confidence: number;
  language: string;

  constructor(correlationId: string, frame: Frame, ocrResult: { text: string; confidence: number; language: string }) {
    this.eventId = crypto.randomUUID();
    this.eventTimestamp = new Date();
    this.correlationId = correlationId;
    this.videoId = frame.videoId;
    this.frameId = frame.id;
    this.textLength = ocrResult.text.length;
    this.confidence = ocrResult.confidence;
    this.language = ocrResult.language;
  }
}

export class TranscriptGenerated implements DomainEvent {
  eventId: string;
  eventType = 'TranscriptGenerated';
  eventTimestamp: Date;
  correlationId: string;
  videoId: string;
  segments: number;
  language: string;
  duration: number;
  model: string;

  constructor(correlationId: string, transcript: { videoId: string; segments: number; language: string; duration: number; model: string }) {
    this.eventId = crypto.randomUUID();
    this.eventTimestamp = new Date();
    this.correlationId = correlationId;
    this.videoId = transcript.videoId;
    this.segments = transcript.segments;
    this.language = transcript.language;
    this.duration = transcript.duration;
    this.model = transcript.model;
  }
}

export class SceneDetected implements DomainEvent {
  eventId: string;
  eventType = 'SceneDetected';
  eventTimestamp: Date;
  correlationId: string;
  videoId: string;
  sceneId: string;
  type: string;
  start: Timestamp;
  end: Timestamp;

  constructor(correlationId: string, scene: { videoId: string; id: string; type: string; start: Timestamp; end: Timestamp }) {
    this.eventId = crypto.randomUUID();
    this.eventTimestamp = new Date();
    this.correlationId = correlationId;
    this.videoId = scene.videoId;
    this.sceneId = scene.id;
    this.type = scene.type;
    this.start = scene.start;
    this.end = scene.end;
  }
}

export class NoteCompleted implements DomainEvent {
  eventId: string;
  eventType = 'NoteCompleted';
  eventTimestamp: Date;
  correlationId: string;
  videoId: string;
  noteId: string;
  sections: number;
  format: string;

  constructor(correlationId: string, note: Note, format: string) {
    this.eventId = crypto.randomUUID();
    this.eventTimestamp = new Date();
    this.correlationId = correlationId;
    this.videoId = note.videoId;
    this.noteId = note.id;
    this.sections = note.getAllSections(true).length;
    this.format = format;
  }
}

export class ProcessingFailed implements DomainEvent {
  eventId: string;
  eventType = 'ProcessingFailed';
  eventTimestamp: Date;
  correlationId: string;
  videoId: string;
  stage: string;
  error: string;
  recoverable: boolean;

  constructor(correlationId: string, videoId: string, stage: string, error: Error, recoverable: boolean = true) {
    this.eventId = crypto.randomUUID();
    this.eventTimestamp = new Date();
    this.correlationId = correlationId;
    this.videoId = videoId;
    this.stage = stage;
    this.error = error.message;
    this.recoverable = recoverable;
  }
}

/**
 * Event publisher interface
 */
export interface IEventPublisher {
  publish(event: DomainEvent): Promise<void>;
  publishAll(events: DomainEvent[]): Promise<void>;
}

/**
 * In-memory event publisher for testing
 */
export class InMemoryEventPublisher implements IEventPublisher {
  private events: DomainEvent[] = [];

  async publish(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    this.events.push(...events);
  }

  getEvents(): DomainEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }
}

/**
 * Domain event types union
 */
export type VideoProcessingEvent =
  | VideoProcessingStarted
  | FrameExtracted
  | OCRCompleted
  | TranscriptGenerated
  | SceneDetected
  | NoteCompleted
  | ProcessingFailed;