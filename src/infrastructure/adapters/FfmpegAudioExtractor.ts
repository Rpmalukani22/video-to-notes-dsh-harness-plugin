import { Video } from '../../domain/entities/Video.js';
import { AudioFile, IAudioExtractor, ILogger, IMetricsCollector } from '../../application/ports/Interfaces.js';
import { spawn } from 'child_process';
import { mkdir, stat } from 'fs/promises';
import { join } from 'path';

/**
 * FFmpeg-based audio extractor.
 * Produces a 16 kHz mono 16-bit PCM WAV, which is what Whisper consumes.
 */

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BYTES_PER_SAMPLE = 2;
/** Canonical 44-byte RIFF/WAVE header written by ffmpeg for PCM. */
const WAV_HEADER_BYTES = 44;

export class FfmpegAudioExtractor implements IAudioExtractor {
  private readonly _ffmpegPath: string;
  private readonly _logger: ILogger;
  private readonly _metrics: IMetricsCollector;
  private readonly _timeoutMs: number;

  constructor(
    ffmpegPath: string = 'ffmpeg',
    logger: ILogger,
    metrics: IMetricsCollector,
    timeoutMs: number = 180000
  ) {
    this._ffmpegPath = ffmpegPath;
    this._logger = logger;
    this._metrics = metrics;
    this._timeoutMs = timeoutMs;
  }

  async extract(video: Video, outputDir: string, signal: AbortSignal): Promise<AudioFile> {
    const startTime = Date.now();
    const outputPath = join(outputDir, 'audio.wav');

    await mkdir(outputDir, { recursive: true });

    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', video.sourcePath,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', String(SAMPLE_RATE),
      '-ac', String(CHANNELS),
      '-y',
      outputPath,
    ];

    try {
      const timeout = Math.max(300000, Math.round(video.durationSeconds * 1000 * 0.5));
      await this.spawnFfmpeg(args, signal, timeout);

      const metadata = await this.getAudioMetadata(outputPath, video.durationSeconds);
      this._metrics.recordHistogram('audio_extraction_duration_ms', Date.now() - startTime);
      this._logger.debug('Audio extracted', { path: outputPath, durationSeconds: metadata.duration });

      return {
        videoId: video.id,
        path: outputPath,
        duration: metadata.duration,
        sampleRate: metadata.sampleRate,
        channels: metadata.channels,
        format: 'wav',
      };
    } catch (error) {
      this._metrics.incrementCounter('audio_extraction_errors');
      throw error;
    }
  }

  private spawnFfmpeg(args: string[], signal: AbortSignal, timeoutMs?: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Audio extraction aborted before start'));
        return;
      }

      const proc = spawn(this._ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs ?? this._timeoutMs,
      });

      let stderr = '';
      let settled = false;

      const onAbort = (): void => {
        proc.kill('SIGKILL');
        finish(new Error('Audio extraction aborted'));
      };
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      };

      signal.addEventListener('abort', onAbort, { once: true });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) finish();
        else finish(new Error(`ffmpeg audio extraction failed (exit ${code}): ${stderr.trim()}`));
      });

      proc.on('error', (err) => {
        finish(new Error(`Failed to spawn ffmpeg (${this._ffmpegPath}): ${err.message}`));
      });
    });
  }

  /**
   * Derive duration without a second external process: the PCM payload size is
   * deterministic, so `(fileSize - 44) / (sampleRate * channels * 2)`.
   */
  private async getAudioMetadata(
    filePath: string,
    fallbackDuration: number
  ): Promise<{ duration: number; sampleRate: number; channels: number }> {
    try {
      const info = await stat(filePath);
      const dataBytes = Math.max(0, info.size - WAV_HEADER_BYTES);
      const duration = dataBytes > 0
        ? dataBytes / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE)
        : fallbackDuration;
      return { duration, sampleRate: SAMPLE_RATE, channels: CHANNELS };
    } catch {
      return { duration: fallbackDuration, sampleRate: SAMPLE_RATE, channels: CHANNELS };
    }
  }

  getSupportedFormats(): string[] {
    return ['mp4', 'mov', 'mkv', 'webm', 'avi', 'flv', 'wmv', 'mp3', 'wav', 'm4a'];
  }
}
