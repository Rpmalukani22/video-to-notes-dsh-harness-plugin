import z from '@deepseek-ai/schemastery';

/**
 * Plugin configuration.
 *
 * Every value has a default so `dsh plugin add <path>` works with an empty
 * config block. Paths are commands resolved on `PATH` unless absolute.
 */
export interface PluginConfig {
  /** ffmpeg executable used for audio extraction and frame capture. */
  ffmpegPath: string;
  /** ffprobe executable used for metadata. */
  ffprobePath: string;
  /** Tesseract executable; OCR is skipped with a warning when absent. */
  tesseractPath: string;
  /** whisper.cpp CLI (usually `whisper-cli`); transcription is skipped when absent. */
  whisperPath: string;
  /** Directory containing ggml Whisper models (`ggml-base.en.bin`, ...). */
  whisperModelDir: string;
  /** Directory notes are written to. Relative paths resolve against the CWD. */
  outputDir: string;
  /** Number of videos analysed at the same time. */
  maxConcurrent: number;
  /** `debug` | `info` | `warn` | `error`. */
  logLevel: string;
  /** Optional YAML file layering processing/LLM settings over the defaults. */
  configPath: string;
}

export const Config = z.object({
  ffmpegPath: z.string().default('ffmpeg'),
  ffprobePath: z.string().default('ffprobe'),
  tesseractPath: z.string().default('tesseract'),
  whisperPath: z.string().default('whisper-cli'),
  whisperModelDir: z.string().default('./models'),
  outputDir: z.string().default('./notes'),
  maxConcurrent: z.natural().min(1).max(16).default(2),
  logLevel: z.string().default('info'),
  configPath: z.string().default(''),
});

export type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

export function normalizeLogLevel(value: string): LogLevelName {
  return value === 'debug' || value === 'warn' || value === 'error' || value === 'info' ? value : 'info';
}
