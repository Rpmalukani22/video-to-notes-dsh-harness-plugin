import { AudioFile, ITranscriptionEngine, TranscriptionConfig } from '../../application/ports/Interfaces.js';
import { Transcript, TranscriptSegment, WordTimestamp } from '../../domain/entities/Transcript.js';
import { Timestamp } from '../../domain/value-objects/Timestamp.js';
import { Confidence } from '../../domain/value-objects/Confidence.js';
import { ILogger, IMetricsCollector } from '../../application/ports/Interfaces.js';
import { spawn } from 'child_process';
import { access, readFile, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

type WhisperModel = TranscriptionConfig['model'];

const MODEL_CHAIN: WhisperModel[] = ['tiny.int8', 'base.int8', 'small.int8', 'large-v3.int8'];

/**
 * whisper.cpp adapter.
 *
 * Runs `whisper-cli -m <model> -f <audio> --output-json <file>` and converts
 * the JSON output into a domain `Transcript`.
 */
export class WhisperTranscriptionEngine implements ITranscriptionEngine {
  private readonly _whisperPath: string;
  private readonly _modelDir: string;
  private readonly _logger: ILogger;
  private readonly _metrics: IMetricsCollector;
  private readonly _timeoutMs: number;
  private _currentModel: string | null = null;

  constructor(
    whisperPath: string,
    modelDir: string,
    logger: ILogger,
    metrics: IMetricsCollector,
    timeoutMs: number = 300000
  ) {
    this._whisperPath = whisperPath;
    this._modelDir = modelDir;
    this._logger = logger;
    this._metrics = metrics;
    this._timeoutMs = timeoutMs;
  }

  async transcribe(audio: AudioFile, config: TranscriptionConfig): Promise<Transcript> {
    const startedAt = Date.now();
    // Fail before spawning anything when the model file is absent.
    await this.resolveModelPath(config.model);

    let result = await this.runTranscription(audio, config);

    if (config.enableEscalation && config.maxEscalations > 0) {
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
        result = await this.runTranscription(audio, current);
        escalations += 1;
      }
    }

    const processingTimeMs = Date.now() - startedAt;
    this._metrics.recordHistogram('transcription_duration_ms', processingTimeMs);
    this._currentModel = config.model;

    return new Transcript(audio.videoId, result.segments, result.language, config.model, processingTimeMs);
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
    // whisper.cpp appends the extension itself: `-oj` writes `<base>.json`, so
    // `--output-file` must be given a name without one.
    const outputBase = join(tmpdir(), `whisper_${process.pid}_${Date.now()}`);
    const outputPath = `${outputBase}.json`;

    const args: string[] = [
      '-m', modelPath,
      '-f', audio.path,
      '-l', config.language ?? 'auto',
      // Full JSON is the only mode that carries per-token offsets, and those
      // are what word-level timestamps are built from.
      config.wordTimestamps ? '-ojf' : '-oj',
      '--output-file', outputBase,
      '-t', '4',
    ];
    // whisper.cpp requires an explicit Silero model for `--vad`; passing the
    // flag alone aborts the run, so it is only added when the model is present.
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

    try {
      await this.spawnWhisper(args);
      const raw = await readFile(outputPath, 'utf8');
      return parseWhisperJson(raw, audio.videoId);
    } catch (error) {
      this._metrics.incrementCounter('transcription_errors');
      throw error;
    } finally {
      await unlink(outputPath).catch(() => undefined);
    }
  }

  private spawnWhisper(args: string[]): Promise<void> {
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
        finish(() => reject(new Error(`whisper.cpp timed out after ${this._timeoutMs}ms`)));
      }, this._timeoutMs);

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

    for (const name of candidates) {
      const candidate = join(this._modelDir, name);
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Try the next spelling.
      }
    }

    throw new Error(
      `Whisper model not found in "${this._modelDir}". Looked for: ${candidates.join(', ')}. ` +
      'Download a ggml model (e.g. ggml-base.en.bin) from ' +
      'https://huggingface.co/ggerganov/whisper.cpp and place it in that directory.'
    );
  }

  /** Locate a Silero VAD model (`ggml-silero-*.bin`) in the model directory. */
  private async resolveVadModelPath(): Promise<string | null> {
    let entries: string[];
    try {
      entries = await readdir(this._modelDir);
    } catch {
      return null;
    }
    const match = entries.find((name) => /silero.*\.bin$/i.test(name));
    return match === undefined ? null : join(this._modelDir, match);
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
