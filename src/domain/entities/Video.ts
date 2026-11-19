import { Timestamp } from '../value-objects/Timestamp.js';
import { Confidence } from '../value-objects/Confidence.js';
import { Frame } from './Frame.js';
import { Transcript } from './Transcript.js';
import { Scene } from './Scene.js';

/**
 * Video metadata extracted via ffprobe
 */
export interface VideoMetadata {
  duration: Timestamp;
  width: number;
  height: number;
  fps: { num: number; den: number };  // Rational (e.g., 30000/1001)
  codec: string;
  bitrate: number;          // bits per second
  format: string;
  size: number;             // bytes
  chapters: Chapter[];
  subtitleTracks: SubtitleTrack[];
  audioTracks: AudioTrack[];
  isVFR: boolean;           // Variable Frame Rate
}

export interface Chapter {
  id: number;
  title: string;
  start: Timestamp;
  end: Timestamp;
}

export interface SubtitleTrack {
  index: number;
  language: string;
  codec: string;
  isDefault: boolean;
  isForced: boolean;
}

export interface AudioTrack {
  index: number;
  language: string;
  codec: string;
  sampleRate: number;
  channels: number;
  bitrate: number;
  isDefault: boolean;
}

/**
 * Video entity - aggregate root for video processing
 */
export class Video {
  private readonly _id: string;
  private readonly _sourcePath: string;
  private _metadata: VideoMetadata;
  private _contentHash: string;
  private readonly _createdAt: Date;
  private _transcript: Transcript | null = null;
  private _frames: Frame[] = [];
  private _scenes: Scene[] = [];

  constructor(
    id: string,
    sourcePath: string,
    metadata: VideoMetadata,
    contentHash: string
  ) {
    this._id = id;
    this._sourcePath = sourcePath;
    this._metadata = metadata;
    this._contentHash = contentHash;
    this._createdAt = new Date();
  }

  get id(): string {
    return this._id;
  }

  get sourcePath(): string {
    return this._sourcePath;
  }

  get metadata(): VideoMetadata {
    return this._metadata;
  }

  get contentHash(): string {
    return this._contentHash;
  }

  setMetadata(metadata: VideoMetadata): void {
    this._metadata = metadata;
  }

  setContentHash(contentHash: string): void {
    this._contentHash = contentHash;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get duration(): Timestamp {
    return this._metadata.duration;
  }

  get resolution(): string {
    return `${this._metadata.width}x${this._metadata.height}`;
  }

  get fps(): number {
    return this._metadata.fps.num / this._metadata.fps.den;
  }

  get durationSeconds(): number {
    return this._metadata.duration.seconds;
  }

  hasSubtitles(): boolean {
    return this._metadata.subtitleTracks.length > 0;
  }

  getDefaultSubtitleTrack(): SubtitleTrack | null {
    return this._metadata.subtitleTracks.find(t => t.isDefault) || this._metadata.subtitleTracks[0] || null;
  }

  hasAudio(): boolean {
    return this._metadata.audioTracks.length > 0;
  }

  getDefaultAudioTrack(): AudioTrack | null {
    return this._metadata.audioTracks.find(t => t.isDefault) || this._metadata.audioTracks[0] || null;
  }

  get transcript(): Transcript | null {
    return this._transcript;
  }

  setTranscript(transcript: Transcript): void {
    this._transcript = transcript;
  }

  get frames(): Frame[] {
    return this._frames;
  }

  addFrame(frame: Frame): void {
    this._frames.push(frame);
  }

  get scenes(): Scene[] {
    return this._scenes;
  }

  addScene(scene: Scene): void {
    this._scenes.push(scene);
  }

  toJSON(): object {
    return {
      id: this._id,
      sourcePath: this._sourcePath,
      metadata: {
        duration: this._metadata.duration.toISO(),
        width: this._metadata.width,
        height: this._metadata.height,
        fps: this._metadata.fps,
        codec: this._metadata.codec,
        bitrate: this._metadata.bitrate,
        format: this._metadata.format,
        size: this._metadata.size,
        chapters: this._metadata.chapters.map(c => ({
          id: c.id,
          title: c.title,
          start: c.start.toISO(),
          end: c.end.toISO()
        })),
        subtitleTracks: this._metadata.subtitleTracks,
        audioTracks: this._metadata.audioTracks,
        isVFR: this._metadata.isVFR
      },
      contentHash: this._contentHash,
      createdAt: this._createdAt.toISOString()
    };
  }
}