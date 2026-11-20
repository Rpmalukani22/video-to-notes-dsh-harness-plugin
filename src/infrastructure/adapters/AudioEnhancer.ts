import { spawn } from 'child_process';
import { join } from 'path';
import { AudioFile, IAudioEnhancer, ILogger, IMetricsCollector } from '../../application/ports/Interfaces.js';

/**
 * FFmpeg-based audio enhancer.
 * Applies highpass/lowpass filtering, FFT noise reduction, dynamic range compression,
 * and loudness normalization to make muffled or fan-noisy speech intelligible for Whisper.
 */
export class AudioEnhancer implements IAudioEnhancer {
  private readonly _ffmpegPath: string;
  private readonly _logger: ILogger;
  private readonly _metrics?: IMetricsCollector | undefined;

  constructor(ffmpegPath: string = 'ffmpeg', logger: ILogger, metrics?: IMetricsCollector | undefined) {
    this._ffmpegPath = ffmpegPath;
    this._logger = logger;
    this._metrics = metrics;
  }

  async enhance(audio: AudioFile, outputDir: string, signal?: AbortSignal): Promise<AudioFile> {
    const startedAt = Date.now();
    const enhancedPath = join(outputDir, `enhanced_${Date.now()}_audio.wav`);

    // Audio filter chain:
    // 1. highpass=f=100: cuts out low fan rumble and electrical hum (<100Hz)
    // 2. lowpass=f=7500: cuts out high frequency hiss (>7.5kHz)
    // 3. afftdn=nf=-20: fast adaptive FFT denoiser
    // 4. acompressor: smooths voice peaks and brings quiet speech up
    // 5. loudnorm: standard speech volume normalization
    const filterChain = 'highpass=f=100,lowpass=f=7500,afftdn=nf=-20,acompressor=threshold=-20dB:ratio=4:attack=5:release=50,loudnorm';

    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-i', audio.path,
      '-af', filterChain,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      enhancedPath,
    ];

    this._logger.info('Enhancing audio with ffmpeg noise reduction', { input: audio.path, output: enhancedPath });

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(this._ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';

      const onAbort = () => {
        proc.kill('SIGKILL');
        reject(new Error('Audio enhancement aborted'));
      };

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      proc.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
      });

      proc.on('close', (code) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ffmpeg audio enhancement exited with code ${code}: ${stderr.trim()}`));
        }
      });

      proc.on('error', (err) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
      });
    });

    const elapsed = Date.now() - startedAt;
    this._logger.info('Audio enhancement complete', { elapsedMs: elapsed, enhancedPath });
    this._metrics?.recordHistogram('audio_enhancement_duration_ms', elapsed);

    return {
      videoId: audio.videoId,
      path: enhancedPath,
      duration: audio.duration,
      sampleRate: 16000,
      channels: 1,
      format: 'wav',
    };
  }
}
