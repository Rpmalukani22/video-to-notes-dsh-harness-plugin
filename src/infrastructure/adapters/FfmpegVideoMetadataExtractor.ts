import { Video, VideoMetadata, Chapter, SubtitleTrack, AudioTrack } from '../../domain/entities/Video.js';
import { Timestamp } from '../../domain/value-objects/Timestamp.js';
import { IVideoMetadataExtractor } from '../../application/ports/Interfaces.js';
import { ILogger, IMetricsCollector } from '../../application/ports/Interfaces.js';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';

/**
 * FFmpeg-based video metadata extractor
 * Uses ffprobe to extract comprehensive video metadata
 */

export class FfmpegVideoMetadataExtractor implements IVideoMetadataExtractor {
  private readonly _ffprobePath: string;
  private readonly _logger: ILogger;
  private readonly _metrics: IMetricsCollector;
  private readonly _timeoutMs: number;

  constructor(
    ffprobePath: string = 'ffprobe',
    logger: ILogger,
    metrics: IMetricsCollector,
    timeoutMs: number = 30000
  ) {
    this._ffprobePath = ffprobePath;
    this._logger = logger;
    this._metrics = metrics;
    this._timeoutMs = timeoutMs;
  }

  async extract(video: Video): Promise<void> {
    const startTime = Date.now();
    try {
      const metadata = await this.runFfprobe(video.sourcePath);

      // Update video entity with extracted metadata
      video.setMetadata(metadata);
      video.setContentHash(await this.computeContentHash(video.sourcePath));
      
      const duration = Date.now() - startTime;
      this._metrics.recordHistogram('ffprobe_duration_ms', duration);
      this._logger.debug('Metadata extracted', { path: video.sourcePath, duration });
    } catch (error) {
      this._metrics.incrementCounter('ffprobe_errors');
      this._logger.error('Failed to extract metadata', { error: (error as Error).message, path: video.sourcePath });
      throw error;
    }
  }

  async runFfprobe(videoPath: string): Promise<VideoMetadata> {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-show_chapters',
      videoPath
    ];

    const output = await this.spawnFfprobe(args);
    const data = JSON.parse(output);

    return this.parseFfprobeOutput(data);
  }

  private async spawnFfprobe(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this._ffprobePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        finish(() => reject(new Error(`ffprobe timeout after ${this._timeoutMs}ms`)));
      }, this._timeoutMs);

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          finish(() => resolve(stdout));
        } else {
          finish(() => reject(new Error(`ffprobe exited with code ${code}: ${stderr}`)));
        }
      });

      proc.on('error', (err) => {
        finish(() => reject(new Error(`Failed to spawn ffprobe: ${err.message}`)));
      });
    });
  }

  private parseFfprobeOutput(data: FfprobeOutput): VideoMetadata {
    const format = data.format ?? {};
    const streams = data.streams ?? [];
    const chapters = data.chapters ?? [];

    // Find video stream
    const videoStream = streams.find((s) => s.codec_type === 'video');
    const audioStreams = streams.filter((s) => s.codec_type === 'audio');
    const subtitleStreams = streams.filter((s) => s.codec_type === 'subtitle');

    // Parse FPS (rational)
    let fpsNum = 30000;
    let fpsDen = 1001;
    if (videoStream?.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      if (num && den) {
        fpsNum = num;
        fpsDen = den;
      }
    }

    // Detect VFR
    const isVFR = videoStream?.avg_frame_rate !== videoStream?.r_frame_rate;

    return {
      duration: Timestamp.fromSeconds(parseFloat(format.duration || '0')),
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      fps: { num: fpsNum, den: fpsDen },
      codec: videoStream?.codec_name || 'unknown',
      bitrate: parseInt(format.bit_rate || '0', 10),
      format: format.format_name || 'unknown',
      size: parseInt(format.size || '0', 10),
      chapters: chapters.map((c) => {
        const id = c.id ?? 0;
        return {
          id,
          title: c.tags?.['title'] ?? `Chapter ${id + 1}`,
          start: Timestamp.fromSeconds(parseFloat(c.start_time ?? '0')),
          end: Timestamp.fromSeconds(parseFloat(c.end_time ?? '0'))
        };
      }),
      subtitleTracks: subtitleStreams.map((s, i) => ({
        index: i,
        language: s.tags?.['language'] ?? 'und',
        codec: s.codec_name ?? 'unknown',
        isDefault: s.disposition?.['default'] === 1,
        isForced: s.disposition?.['forced'] === 1
      })),
      audioTracks: audioStreams.map((s, i) => ({
        index: i,
        language: s.tags?.['language'] ?? 'und',
        codec: s.codec_name ?? 'unknown',
        sampleRate: parseInt(s.sample_rate ?? '0', 10),
        channels: s.channels ?? 0,
        bitrate: parseInt(s.bit_rate ?? '0', 10),
        isDefault: s.disposition?.['default'] === 1
      })),
      isVFR
    };
  }

  private async computeContentHash(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(createReadStream(filePath), hash);
    return `sha256:${hash.digest('hex')}`;
  }

  getSupportedFormats(): string[] {
    return ['mp4', 'mov', 'mkv', 'webm', 'avi', 'flv', 'wmv'];
  }
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
  tags?: Record<string, string>;
  disposition?: Record<string, number>;
}

interface FfprobeOutput {
  format?: {
    duration?: string;
    bit_rate?: string;
    format_name?: string;
    size?: string;
  };
  streams?: FfprobeStream[];
  chapters?: Array<{
    id?: number;
    start_time?: string;
    end_time?: string;
    tags?: Record<string, string>;
  }>;
}