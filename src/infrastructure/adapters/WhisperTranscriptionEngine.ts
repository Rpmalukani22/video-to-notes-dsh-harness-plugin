import { AudioFile, ITranscriptionEngine, TranscriptionConfig } from '../../application/ports/Interfaces.js';
import { Transcript, TranscriptSegment, WordTimestamp } from '../../domain/entities/Transcript.js';
import { Timestamp } from '../../domain/value-objects/Timestamp.js';
import { Confidence } from '../../domain/value-objects/Confidence.js';
import { ILogger, IMetricsCollector } from '../../application/ports/Interfaces.js';
import { spawn } from 'child_process';
import { access, readFile, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { AudioChunker } from './AudioChunker.js';

type WhisperModel = TranscriptionConfig['model'];

const MODEL_CHAIN: WhisperModel[] = ['tiny.int8', 'base.int8', 'small.int8', 'large-v3.int8'];

/**
 * whisper.cpp adapter.
 *
 * Runs `whisper-cli -m <model> -f <audio> --output-json <file>` and converts
 * the JSON output into a domain `Transcript`.
 * Features:
 * - Dynamic timeout scaling with audio duration (never static 5m)
 * - Automatic chunking for long audio (>10m) with seamless timestamp stitching
 * - Instant chunk-level VAD fallback when audio has speech obscured by noise
 */
export class WhisperTranscriptionEngine implements ITranscriptionEngine {
  private readonly _whisperPath: string;
  private readonly _modelDir: string;
  private readonly _logger: ILogger;
  private readonly _metrics: IMetricsCollector;
  private readonly _chunker: AudioChunker;
  private _currentModel: string | null = null;

  constructor(
    whisperPath: string,
    modelDir: string,
    logger: ILogger,
    metrics: IMetricsCollector,
    ffmpegPath: string = 'ffmpeg'
  ) {
    this._whisperPath = whisperPath;
    this._modelDir = modelDir;
    this._logger = logger;
    this._metrics = metrics;
    this._chunker = new AudioChunker(ffmpegPath, logger);
  }

  async transcribe(audio: AudioFile, config: TranscriptionConfig): Promise<Transcript> {
    const startedAt = Date.now();
    // Fail before spawning anything when the model file is absent.
    await this.resolveModelPath(config.model);

    // If audio is longer than 10 minutes (600s), process in chunks for resilience & progress
    let result: { segments: TranscriptSegment[]; language: string; averageConfidence: number };
    if (audio.duration > 600) {
      result = await this.transcribeChunked(audio, config);
    } else {
      result = await this.runTranscriptionWithFallback(audio, config);
    }

    if (config.enableEscalation && config.maxEscalations > 0 && result.segments.length > 0) {
      let escalations = 0;
      let current = config;
      while (result.averageConfidence < config.escalationThreshold && escalations < config.maxEscalations) {
        const nextModel = this.getNextLargerModel(current.model);
        if (nextModel === current.model) break;
        this._logger.info('Escalating transcription model', {
          from: current.model,
          to: nextModel,
          confidence: result.averageConfidence,
        });
        current = { ...current, model: nextModel };
        result = audio.duration > 600
          ? await this.transcribeChunked(audio, current)
          : await this.runTranscriptionWithFallback(audio, current);
        escalations += 1;
      }
    }

    const processingTimeMs = Date.now() - startedAt;
    this._metrics.recordHistogram('transcription_duration_ms', processingTimeMs);
    this._currentModel = config.model;

    return new Transcript(audio.videoId, result.segments, result.language, config.model, processingTimeMs);
  }

  private async transcribeChunked(
    audio: AudioFile,
    config: TranscriptionConfig
  ): Promise<{ segments: TranscriptSegment[]; language: string; averageConfidence: number }> {
    const chunks = await this._chunker.splitIntoChunks(audio, tmpdir(), 600);
    const allSegments: TranscriptSegment[] = [];
    let detectedLanguage = config.language ?? 'en';
    let totalConfidenceSum = 0;
    let totalSegmentCount = 0;

    this._logger.info(`Starting chunked transcription for ${chunks.length} chunks...`);

    try {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        this._logger.info(`Transcribing chunk ${i + 1}/${chunks.length} (${chunk.startSec.toFixed(0)}s - ${(chunk.startSec + chunk.durationSec).toFixed(0)}s)...`);

        const chunkResult = await this.runTranscriptionWithFallback(chunk.audioFile, config);
        if (chunkResult.language && chunkResult.language !== 'auto') {
          detectedLanguage = chunkResult.language;
        }

        const offsetMs = Math.round(chunk.startSec * 1000);
        for (const seg of chunkResult.segments) {
          const startMs = seg.start.milliseconds + offsetMs;
          const endMs = seg.end.milliseconds + offsetMs;
          const offsetWords = seg.words.map((w) => ({
            ...w,
            start: Timestamp.fromMilliseconds(w.start.milliseconds + offsetMs),
            end: Timestamp.fromMilliseconds(w.end.milliseconds + offsetMs),
          }));

          allSegments.push(
            new TranscriptSegment(
              `seg-${audio.videoId}-${startMs}`,
              Timestamp.fromMilliseconds(startMs),
              Timestamp.fromMilliseconds(endMs),
              seg.text,
              seg.confidence,
              offsetWords,
              seg.language,
              seg.speakerId
            )
          );

          totalConfidenceSum += seg.confidence.value;
          totalSegmentCount++;
        }
      }
    } finally {
      await this._chunker.cleanupChunks(chunks);
    }

    const averageConfidence = totalSegmentCount > 0 ? totalConfidenceSum / totalSegmentCount : 0;
    this._logger.info(`Chunked transcription complete: ${allSegments.length} total segments transcribed`);
    return { segments: allSegments, language: detectedLanguage, averageConfidence };
  }

  private async runTranscriptionWithFallback(
    audio: AudioFile,
    config: TranscriptionConfig
  ): Promise<{ segments: TranscriptSegment[]; language: string; averageConfidence: number }> {
    let result = await this.runTranscription(audio, config);

    // If VAD was enabled but resulted in zero segments on a non-empty audio track,
    // automatically fallback to transcribing without VAD!
    if (result.segments.length === 0 && config.enableVAD && audio.duration > 8) {
      this._logger.warn(`VAD yielded 0 segments for audio (${audio.duration.toFixed(1)}s); retrying without VAD...`);
      const noVadConfig = { ...config, enableVAD: false };
      result = await this.runTranscription(audio, noVadConfig);
    }

    return result;
  }

  getSupportedModels(): string[] {
    return [...MODEL_CHAIN];
  }

  getSupportedLanguages(): string[] {
    return ['auto', 'en', 'zh', 'de', 'es', 'ru', 'ko', 'fr', 'ja', 'pt', 'tr', 'pl', 'ca', 'nl', 'ar', 'sv', 'it', 'id', 'hi', 'fi', 'vi', 'he', 'uk', 'el', 'ms', 'cs', 'ro', 'da', 'no', 'sk', 'hu', 'ta', 'th', 'ur', 'hr', 'bg', 'lt', 'lv', 'sr', 'sl', 'et', 'mt', 'is', 'mk', 'hy', 'ka', 'bn', 'gu', 'kn', 'ml', 'mr', 'ne', 'or', 'pa', 'si', 'te'];
  }

  async warmup(): Promise<void> {
    await this.resolveModelPath('base.int8');
  }

  private async runTranscription(
    audio: AudioFile,
    config: TranscriptionConfig
  ): Promise<{ segments: TranscriptSegment[]; language: string; averageConfidence: number }> {
    const modelPath = await this.resolveModelPath(config.model);
    const outputBase = join(tmpdir(), `whisper_${process.pid}_${Date.now()}`);
    const outputPath = `${outputBase}.json`;

    const args: string[] = [
      '-m', modelPath,
      '-f', audio.path,
      '-l', config.language ?? 'auto',
      config.wordTimestamps ? '-ojf' : '-oj',
      '--output-file', outputBase,
      '-t', '4',
    ];

    if (config.enableVAD) {
      const vadModel = await this.resolveVadModelPath();
      if (vadModel !== null) {
        args.push('--vad', '-vm', vadModel);
      } else {
        this._logger.debug('VAD enabled but no Silero model found; transcribing without it', {
          modelDir: this._modelDir,
        });
      }
    }
    if (config.vocabularyBoost && config.vocabularyBoost.length > 0) {
      args.push('--prompt', config.vocabularyBoost);
    }

    // Dynamic timeout: scales with audio duration + generous buffer
    const timeoutMs = Math.max(600000, Math.round(audio.duration * 1000 * 2.0));

    try {
      await this.spawnWhisper(args, timeoutMs);
      const raw = await readFile(outputPath, 'utf8');
      return parseWhisperJson(raw, audio.videoId);
    } catch (error) {
      this._metrics.incrementCounter('transcription_errors');
      throw error;
    } finally {
      await unlink(outputPath).catch(() => undefined);
    }
  }

  private spawnWhisper(args: string[], timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this._whisperPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
        finish(() => reject(new Error(`whisper.cpp timed out after ${timeoutMs}ms`)));
      }, timeoutMs);

      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      proc.stdout.on('data', () => undefined);

      proc.on('close', (code) => {
        if (code === 0) finish(resolve);
        else finish(() => reject(new Error(`whisper.cpp exited with code ${code}: ${stderr.trim()}`)));
      });

      proc.on('error', (err) => {
        finish(() => reject(new Error(`Failed to spawn ${this._whisperPath}: ${err.message}`)));
      });
    });
  }

  /**
   * Resolve a logical model name (`base.int8`) to a file in the model
   * directory. whisper.cpp ships `ggml-base.en.bin`, but older installs and
   * pre-converted models use other names, so accept every common spelling.
   */
  private async resolveModelPath(model: WhisperModel): Promise<string> {
    const base = model.replace(/\.int8$/i, '');
    const candidates = [
      `${model}.bin`,          // base.int8.bin (pre-converted)
      `ggml-${base}.bin`,      // ggml-base.bin
      `ggml-${base}.en.bin`,   // ggml-base.en.bin (whisper.cpp download)
    ];

    const searchDirs = [this._modelDir];
    if (this._modelDir === './models' || this._modelDir === 'models') {
      const cwdModels = join(process.cwd(), 'models');
      if (!searchDirs.includes(cwdModels)) searchDirs.push(cwdModels);
      const envDir = process.env['WHISPER_MODELS_DIR'];
      if (envDir && !searchDirs.includes(envDir)) {
        searchDirs.push(envDir);
      }
    }

    for (const dir of searchDirs) {
      for (const name of candidates) {
        const candidate = join(dir, name);
        try {
          await access(candidate);
          return candidate;
        } catch {
          // Try next
        }
      }
    }

    throw new Error(
      `Whisper model not found in "${this._modelDir}". Looked for: ${candidates.join(', ')}. ` +
      'Download a ggml model (e.g. ggml-base.en.bin) from ' +
      'https://huggingface.co/ggerganov/whisper.cpp and place it in that directory.'
    );
  }

  /** Locate a Silero VAD model (`ggml-silero-*.bin`) in the model directory or fallback paths. */
  private async resolveVadModelPath(): Promise<string | null> {
    const searchDirs = [this._modelDir];
    if (this._modelDir === './models' || this._modelDir === 'models') {
      const cwdModels = join(process.cwd(), 'models');
      if (!searchDirs.includes(cwdModels)) searchDirs.push(cwdModels);
      const envDir = process.env['WHISPER_MODELS_DIR'];
      if (envDir && !searchDirs.includes(envDir)) {
        searchDirs.push(envDir);
      }
    }

    for (const dir of searchDirs) {
      try {
        const entries = await readdir(dir);
        const match = entries.find((name) => /silero.*\.bin$/i.test(name));
        if (match) return join(dir, match);
      } catch {
        continue;
      }
    }
    return null;
  }

  private getNextLargerModel(current: WhisperModel): WhisperModel {
    const idx = MODEL_CHAIN.indexOf(current);
    return idx >= 0 && idx < MODEL_CHAIN.length - 1 ? (MODEL_CHAIN[idx + 1] as WhisperModel) : current;
  }
}

interface WhisperToken {
  text?: string;
  offsets?: { from?: number; to?: number };
}

interface WhisperSegment {
  offsets?: { from?: number; to?: number };
  timestamps?: { from?: string; to?: string };
  text?: string;
  tokens?: WhisperToken[];
}

interface WhisperDocument {
  transcription?: WhisperSegment[];
  result?: { language?: string };
  params?: { language?: string };
}

/**
 * Parse whisper.cpp `-oj` output. Handles both the `transcription` array used
 * by current releases and a bare `segments` array from older builds.
 */
export function parseWhisperJson(raw: string, videoId: string): {
  segments: TranscriptSegment[];
  language: string;
  averageConfidence: number;
} {
  const doc = JSON.parse(raw) as WhisperDocument & { segments?: WhisperSegment[] };
  const rawSegments = doc.transcription ?? doc.segments ?? [];
  const language = doc.result?.language ?? doc.params?.language ?? 'auto';

  const segments: TranscriptSegment[] = [];
  for (const segment of rawSegments) {
    const text = (segment.text ?? '').trim();
    if (text.length === 0) continue;

    const startMs = segment.offsets?.from ?? parseTimestampMs(segment.timestamps?.from) ?? 0;
    const endMs = segment.offsets?.to ?? parseTimestampMs(segment.timestamps?.to) ?? startMs;
    const start = Timestamp.fromMilliseconds(Math.max(0, startMs));
    const end = Timestamp.fromMilliseconds(Math.max(startMs, endMs));

    const words: WordTimestamp[] = (segment.tokens ?? [])
      .map((token) => (token.text ?? '').trim())
      .filter((word) => word.length > 0 && !/^\[.*\]$/.test(word))
      .map((word) => ({
        word,
        start,
        end,
        confidence: new Confidence(0.9),
      }));

    segments.push(
      new TranscriptSegment(
        `seg-${videoId}-${startMs}`,
        start,
        end,
        text,
        new Confidence(0.9),
        words,
        language,
        null
      )
    );
  }

  const averageConfidence = segments.length === 0
    ? 0
    : segments.reduce((acc, s) => acc + s.confidence.value, 0) / segments.length;

  return { segments, language, averageConfidence };
}

function parseTimestampMs(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const millis = Number(match[4] ?? 0);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}
