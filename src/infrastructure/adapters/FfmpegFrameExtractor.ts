import { Video } from '../../domain/entities/Video.js';
import { Frame } from '../../domain/entities/Frame.js';
import { Timestamp } from '../../domain/value-objects/Timestamp.js';
import { IFrameExtractor, FrameExtractionConfig, ILogger, IMetricsCollector } from '../../application/ports/Interfaces.js';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

/**
 * FFmpeg-based frame extractor.
 *
 * Two strategies:
 *  - fast: seek to a fixed interval and grab one frame per stop.
 *  - adaptive: ask ffmpeg's `scene` filter where cuts happen, then grab a frame
 *    at each cut; fall back to intervals if the video has too few cuts.
 *
 * Frames are streamed as in-memory JPEG buffers, so nothing is written to disk
 * for the visual track.
 */

export class FfmpegFrameExtractor implements IFrameExtractor {
  private readonly _ffmpegPath: string;
  private readonly _logger: ILogger;
  private readonly _metrics: IMetricsCollector;
  private readonly _timeoutMs: number;

  constructor(
    ffmpegPath: string = 'ffmpeg',
    logger: ILogger,
    metrics: IMetricsCollector,
    timeoutMs: number = 300000
  ) {
    this._ffmpegPath = ffmpegPath;
    this._logger = logger;
    this._metrics = metrics;
    this._timeoutMs = timeoutMs;
  }

  async *extractFrames(
    video: Video,
    config: FrameExtractionConfig,
    signal: AbortSignal
  ): AsyncIterable<Frame> {
    const startTime = Date.now();
    try {
      if (config.fastExtract) {
        yield* this.extractFramesFast(video, config, signal);
      } else {
        yield* this.extractFramesAdaptive(video, config, signal);
      }
      this._metrics.recordHistogram('frame_extraction_duration_ms', Date.now() - startTime);
    } catch (error) {
      this._metrics.incrementCounter('frame_extraction_errors');
      throw error;
    }
  }

  private async *extractFramesFast(
    video: Video,
    config: FrameExtractionConfig,
    signal: AbortSignal
  ): AsyncIterable<Frame> {
    const intervalSec = Math.max(1, config.fastIntervalSec ?? config.intervalSec ?? 30);
    const durationSec = video.durationSeconds;
    const maxFrames = config.maxFrames > 0 ? config.maxFrames : Number.POSITIVE_INFINITY;

    let yielded = 0;
    for (let t = 0; t < durationSec && yielded < maxFrames && !signal.aborted; t += intervalSec) {
      const frame = await this.extractFrameAtTimestamp(video, t);
      if (frame) {
        yielded += 1;
        this._metrics.incrementCounter('frames_extracted_fast');
        yield frame;
      }
    }
  }

  private async *extractFramesAdaptive(
    video: Video,
    config: FrameExtractionConfig,
    signal: AbortSignal
  ): AsyncIterable<Frame> {
    const sceneFrames = await this.extractSceneFrames(video, config, signal);
    const target = config.maxFrames > 0 ? Math.min(config.maxFrames, 100) : 100;

    let frames = sceneFrames;
    if (sceneFrames.length < target) {
      const supplemental = await this.extractIntervalFrames(video, config, signal, sceneFrames);
      frames = this.mergeAndDeduplicateFrames(sceneFrames, supplemental);
    }

    const cap = config.maxFrames > 0 ? config.maxFrames : frames.length;
    for (const frame of frames.slice(0, cap)) {
      if (signal.aborted) break;
      yield frame;
    }
  }

  /** Detect scene cuts with ffmpeg's scene filter and grab a frame at each one. */
  private async extractSceneFrames(
    video: Video,
    config: FrameExtractionConfig,
    signal: AbortSignal
  ): Promise<Frame[]> {
    const cutTimestampsMs = await this.detectSceneCuts(video, config, signal);
    const cap = config.maxFrames > 0 ? config.maxFrames : cutTimestampsMs.length;

    const frames: Frame[] = [];
    for (const ms of cutTimestampsMs.slice(0, cap)) {
      if (signal.aborted) break;
      const frame = await this.extractFrameAtTimestamp(video, ms / 1000);
      if (frame) frames.push(frame);
    }

    this._logger.debug('Scene-based frame extraction finished', {
      videoId: video.id,
      cuts: cutTimestampsMs.length,
      frames: frames.length,
    });
    return frames;
  }

  private detectSceneCuts(
    video: Video,
    config: FrameExtractionConfig,
    signal: AbortSignal
  ): Promise<number[]> {
    const args = [
      '-hide_banner',
      '-loglevel', 'info',
      '-i', video.sourcePath,
      '-vf', `select='gt(scene,${config.sceneThreshold})',showinfo`,
      '-an',
      '-f', 'null',
      '-',
    ];

    return new Promise<number[]>((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Scene detection aborted before start'));
        return;
      }

      const proc = spawn(this._ffmpegPath, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: this._timeoutMs,
      });

      let stderr = '';
      let settled = false;

      const onAbort = (): void => {
        proc.kill('SIGKILL');
        finish(new Error('Scene detection aborted'));
      };
      const finish = (error?: Error, value?: number[]): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve(value ?? []);
      };

      signal.addEventListener('abort', onAbort, { once: true });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          finish(new Error(`ffmpeg scene detection exited with ${code}`));
          return;
        }
        finish(undefined, parseShowinfoTimestamps(stderr));
      });

      proc.on('error', (err) => {
        finish(new Error(`Failed to spawn ffmpeg (${this._ffmpegPath}): ${err.message}`));
      });
    });
  }

  private async extractIntervalFrames(
    video: Video,
    config: FrameExtractionConfig,
    signal: AbortSignal,
    existingFrames: Frame[]
  ): Promise<Frame[]> {
    const intervalSec = Math.max(1, config.minIntervalSec || 30);
    const durationSec = video.durationSeconds;
    const existing = new Set(existingFrames.map((f) => Math.round(f.timestamp.seconds)));
    const cap = config.maxFrames > 0 ? config.maxFrames : Number.POSITIVE_INFINITY;

    const frames: Frame[] = [];
    for (let t = 0; t <= durationSec && frames.length < cap && !signal.aborted; t += intervalSec) {
      if (existing.has(Math.round(t))) continue;
      const frame = await this.extractFrameAtTimestamp(video, t);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  /** Grab a single frame (JPEG bytes) at the given time using a fast input seek. */
  private extractFrameAtTimestamp(video: Video, timestampSec: number): Promise<Frame | null> {
    const safeTimestamp = Math.max(0, timestampSec);
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-ss', safeTimestamp.toFixed(3),
      '-i', video.sourcePath,
      '-frames:v', '1',
      '-an',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-',
    ];

    return new Promise<Frame | null>((resolve, reject) => {
      const proc = spawn(this._ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      });

      const chunks: Buffer[] = [];
      proc.stdout?.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      proc.on('close', (code) => {
        const imageData = Buffer.concat(chunks);
        if (code === 0 && imageData.length > 0) {
          resolve(
            new Frame(
              `frame_${randomUUID()}`,
              video.id,
              Timestamp.fromSeconds(safeTimestamp),
              Math.round(safeTimestamp * 1000),
              null,
              imageData
            )
          );
        } else {
          resolve(null);
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn ffmpeg (${this._ffmpegPath}): ${err.message}`));
      });
    });
  }

  private mergeAndDeduplicateFrames(frames1: Frame[], frames2: Frame[]): Frame[] {
    const bySecond = new Map<number, Frame>();
    for (const frame of [...frames1, ...frames2]) {
      const key = Math.round(frame.timestamp.seconds);
      const existing = bySecond.get(key);
      if (!existing || frame.getOCRConfidence() > existing.getOCRConfidence()) {
        bySecond.set(key, frame);
      }
    }
    return [...bySecond.values()].sort((a, b) => a.timestamp.seconds - b.timestamp.seconds);
  }

  getEstimatedFrameCount(video: Video, config: FrameExtractionConfig): number {
    const durationSec = video.durationSeconds;
    if (config.fastExtract) {
      const interval = Math.max(1, config.fastIntervalSec ?? config.intervalSec ?? 30);
      return Math.ceil(durationSec / interval);
    }
    return Math.max(Math.ceil(durationSec / 10), 10);
  }

  getSupportedFormats(): string[] {
    return ['mp4', 'mov', 'mkv', 'webm', 'avi', 'flv', 'wmv'];
  }
}

/** Pull `pts_time:` values out of ffmpeg `showinfo` stderr output, in milliseconds. */
export function parseShowinfoTimestamps(output: string): number[] {
  const timestamps: number[] = [];
  const regex = /pts_time:\s*([0-9]+(?:\.[0-9]+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(output)) !== null) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds >= 0) {
      timestamps.push(Math.round(seconds * 1000));
    }
  }
  return timestamps;
}
