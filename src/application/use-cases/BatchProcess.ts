import { extname, resolve } from 'path';
import { stat } from 'fs/promises';
import { createHash } from 'crypto';
import fg from 'fast-glob';
import { Note } from '../../domain/entities/Note.js';
import {
  PipelineContext,
  ILogger,
  IMetricsCollector,
  ICheckpointStore,
  IConfigurationProvider,
  ProcessingConfig,
} from '../ports/Interfaces.js';
import { AnalyzeVideo, AnalyzeVideoOutput } from './AnalyzeVideo.js';

/**
 * BatchProcess use case.
 *
 * Scans files/directories for videos, runs AnalyzeVideo over them with bounded
 * concurrency, and persists a checkpoint after every completed video so an
 * interrupted batch resumes without redoing finished work.
 */

export interface BatchProcessInput {
  inputPaths: string[];
  config?: Partial<ProcessingConfig> | undefined;
  outputDir?: string | undefined;
  formats?: ('md' | 'json' | 'html')[] | undefined;
  maxConcurrent?: number | undefined;
  resume?: boolean | undefined;
  progressCallback?: ((update: BatchProgressUpdate) => void) | undefined;
}

export interface BatchProgressUpdate {
  phase: 'scanning' | 'processing' | 'completed' | 'failed';
  totalVideos: number;
  completedVideos: number;
  failedVideos: number;
  currentVideo?: string | undefined;
  currentVideoProgress?: { stage: string; percent: number } | undefined;
  etaSeconds: number;
  throughput: string;
}

export interface BatchProcessOutput {
  results: BatchVideoResult[];
  summary: BatchSummary;
}

export interface BatchVideoResult {
  videoPath: string;
  success: boolean;
  note?: Note | undefined;
  error?: string | undefined;
  processingTimeMs: number;
  outputFiles: string[];
  warnings: string[];
}

export interface BatchSummary {
  totalVideos: number;
  successful: number;
  failed: number;
  skipped: number;
  totalProcessingTimeMs: number;
  averageTimePerVideoMs: number;
  totalOutputSize: number;
}

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.flv', '.wmv', '.mpg', '.mpeg', '.ts',
]);

export class BatchProcess {
  constructor(
    private readonly _analyzeVideo: AnalyzeVideo,
    private readonly _configProvider: IConfigurationProvider,
    private readonly _checkpointStore: ICheckpointStore,
    private readonly _metrics: IMetricsCollector,
    private readonly _logger: ILogger
  ) {}

  async execute(input: BatchProcessInput, context: PipelineContext): Promise<BatchProcessOutput> {
    const executionStartTime = Date.now();
    const signal = context.signal;

    const baseConfig = this._configProvider.getVideoProcessingConfig();
    const maxConcurrent = Math.max(1, input.maxConcurrent ?? baseConfig.batch.maxConcurrent);
    const resume = input.resume ?? baseConfig.batch.resume;
    const config: ProcessingConfig = {
      ...baseConfig,
      ...input.config,
      batch: { ...baseConfig.batch, maxConcurrent, resume },
    };

    this.report(input, {
      phase: 'scanning',
      totalVideos: 0,
      completedVideos: 0,
      failedVideos: 0,
      etaSeconds: 0,
      throughput: '',
    });

    const videoFiles = await this.scanVideoFiles(input.inputPaths);
    this._logger.info(`Found ${videoFiles.length} video(s)`);

    if (videoFiles.length === 0) {
      return {
        results: [],
        summary: {
          totalVideos: 0,
          successful: 0,
          failed: 0,
          skipped: 0,
          totalProcessingTimeMs: Date.now() - executionStartTime,
          averageTimePerVideoMs: 0,
          totalOutputSize: 0,
        },
      };
    }

    const checkpointKey = this.buildCheckpointKey(videoFiles, config.frameExtraction.preset);
    const checkpoint = resume ? await this._checkpointStore.load(checkpointKey) : null;
    const alreadyCompleted = new Set<string>(readStringArray(checkpoint?.['completed']));
    const previousFailures = new Map<string, string>(readFailurePairs(checkpoint?.['failed']));

    const results: BatchVideoResult[] = [];
    let nextIndex = 0;
    let completedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const startTime = Date.now();

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = nextIndex++;
        const videoPath = videoFiles[index];
        if (!videoPath) return;

        if (signal.aborted) return;

        if (alreadyCompleted.has(videoPath)) {
          skippedCount += 1;
          this._logger.info('Skipping already completed video', { videoPath });
          continue;
        }

        this.report(input, {
          phase: 'processing',
          totalVideos: videoFiles.length,
          completedVideos: completedCount,
          failedVideos: failedCount,
          currentVideo: videoPath,
          etaSeconds: this.estimateEta(videoFiles.length, completedCount + failedCount + skippedCount, startTime),
          throughput: this.throughput(completedCount + failedCount, startTime),
        });

        const result = await this.processSingleVideo(videoPath, config, input, context, completedCount + failedCount, videoFiles.length);
        results.push(result);

        if (result.success) {
          completedCount += 1;
          alreadyCompleted.add(videoPath);
          previousFailures.delete(videoPath);
        } else {
          failedCount += 1;
          previousFailures.set(videoPath, result.error ?? 'Unknown error');
          this._metrics.incrementCounter('batch_video_failed');
        }

        await this.saveCheckpoint(checkpointKey, alreadyCompleted, previousFailures);
      }
    };

    await Promise.all(Array.from({ length: Math.min(maxConcurrent, videoFiles.length) }, () => worker()));

    const totalProcessingTimeMs = Date.now() - executionStartTime;
    const totalOutputSize = await this.sumOutputSizes(results);
    const summary: BatchSummary = {
      totalVideos: videoFiles.length,
      successful: completedCount,
      failed: failedCount,
      skipped: skippedCount,
      totalProcessingTimeMs,
      averageTimePerVideoMs: completedCount > 0 ? totalProcessingTimeMs / completedCount : 0,
      totalOutputSize,
    };

    // Keep the checkpoint only when something actually failed, so a re-run can
    // retry just those videos; otherwise it is stale state.
    if (failedCount === 0) {
      await this._checkpointStore.delete(checkpointKey).catch(() => undefined);
    }

    this._metrics.recordHistogram('batch_duration_ms', totalProcessingTimeMs);
    this.report(input, {
      phase: failedCount > 0 ? 'failed' : 'completed',
      totalVideos: videoFiles.length,
      completedVideos: completedCount,
      failedVideos: failedCount,
      etaSeconds: 0,
      throughput: this.throughput(completedCount + failedCount, startTime),
    });

    return { results, summary };
  }

  private async processSingleVideo(
    videoPath: string,
    config: ProcessingConfig,
    input: BatchProcessInput,
    context: PipelineContext,
    done: number,
    total: number
  ): Promise<BatchVideoResult> {
    const startTime = Date.now();
    try {
      const output: AnalyzeVideoOutput = await this._analyzeVideo.execute(
        {
          videoPath,
          config,
          ...(input.outputDir !== undefined ? { outputDir: input.outputDir } : {}),
          ...(input.formats !== undefined ? { formats: input.formats } : {}),
          progressCallback: (progress) => {
            this.report(input, {
              phase: 'processing',
              totalVideos: total,
              completedVideos: done,
              failedVideos: 0,
              currentVideo: videoPath,
              currentVideoProgress: { stage: progress.stage, percent: progress.percent },
              etaSeconds: progress.etaSeconds,
              throughput: progress.throughput,
            });
          },
        },
        {
          videoId: crypto.randomUUID(),
          correlationId: context.correlationId,
          metrics: this._metrics,
          logger: this._logger,
          signal: context.signal,
        }
      );

      return {
        videoPath,
        success: true,
        note: output.note,
        processingTimeMs: Date.now() - startTime,
        outputFiles: output.outputFiles,
        warnings: output.warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._logger.error('Batch video failed', { videoPath, error: message });
      return {
        videoPath,
        success: false,
        error: message,
        processingTimeMs: Date.now() - startTime,
        outputFiles: [],
        warnings: [],
      };
    }
  }

  // -------------------------------------------------------------------------
  // Scanning
  // -------------------------------------------------------------------------

  private async scanVideoFiles(paths: string[]): Promise<string[]> {
    const found = new Set<string>();

    for (const inputPath of paths) {
      let info;
      try {
        info = await stat(inputPath);
      } catch {
        // Not a literal path - maybe a glob.
        if (/[*?[\]{}]/.test(inputPath)) {
          const matches = await fg(inputPath.replace(/\\/g, '/'), { absolute: true, onlyFiles: true, unique: true });
          for (const match of matches) {
            if (isVideo(match)) found.add(resolve(match));
          }
        } else {
          this._logger.warn('Input path does not exist', { path: inputPath });
        }
        continue;
      }

      if (info.isDirectory()) {
        const matches = await fg('**/*', {
          cwd: resolve(inputPath),
          absolute: true,
          onlyFiles: true,
          unique: true,
          dot: false,
        });
        for (const match of matches) {
          if (isVideo(match)) found.add(resolve(match));
        }
      } else if (info.isFile() && isVideo(inputPath)) {
        found.add(resolve(inputPath));
      } else {
        this._logger.warn('Skipping non-video input', { path: inputPath });
      }
    }

    return [...found].sort();
  }

  private buildCheckpointKey(paths: string[], preset: string): string {
    const hash = createHash('sha256').update([...paths].sort().join('\n')).digest('hex').slice(0, 16);
    return `batch-${hash}-${preset}`;
  }

  private async saveCheckpoint(
    key: string,
    completed: Set<string>,
    failed: Map<string, string>
  ): Promise<void> {
    try {
      await this._checkpointStore.save(key, {
        stage: 1,
        completed: [...completed],
        failed: [...failed.entries()],
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      this._logger.warn('Could not save batch checkpoint', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async sumOutputSizes(results: BatchVideoResult[]): Promise<number> {
    let total = 0;
    for (const result of results) {
      for (const file of result.outputFiles) {
        try {
          total += (await stat(file)).size;
        } catch {
          // Output file already gone; ignore.
        }
      }
    }
    return total;
  }

  // -------------------------------------------------------------------------
  // Progress
  // -------------------------------------------------------------------------

  private report(input: BatchProcessInput, update: BatchProgressUpdate): void {
    try {
      input.progressCallback?.(update);
    } catch (error) {
      this._logger.warn('Batch progressCallback threw', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private estimateEta(total: number, done: number, startTime: number): number {
    if (done <= 0) return 0;
    const perVideoMs = (Date.now() - startTime) / done;
    return Math.round((perVideoMs * Math.max(0, total - done)) / 1000);
  }

  private throughput(done: number, startTime: number): string {
    const elapsedHours = (Date.now() - startTime) / 3_600_000;
    if (done === 0 || elapsedHours <= 0) return '0 videos/hour';
    return `${(done / elapsedHours).toFixed(1)} videos/hour`;
  }
}

function isVideo(filePath: string): boolean {
  return VIDEO_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readFailurePairs(value: unknown): [string, string][] {
  if (!Array.isArray(value)) return [];
  const pairs: [string, string][] = [];
  for (const entry of value) {
    if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
      pairs.push([entry[0], entry[1]]);
    }
  }
  return pairs;
}
