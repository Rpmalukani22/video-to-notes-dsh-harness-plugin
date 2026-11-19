import { randomUUID } from 'crypto';
import { AnalyzeVideoOutput, ProgressUpdate } from '../../application/use-cases/AnalyzeVideo.js';
import { ProcessingConfig } from '../../application/ports/Interfaces.js';
import { Services } from '../../infrastructure/composition/createServices.js';

/**
 * In-memory job registry for the plugin.
 *
 * Video analysis runs for minutes, so the tool returns a job id immediately and
 * a status tool reports progress. The registry also bounds concurrency, which
 * matters because every job spawns ffmpeg, Tesseract and Whisper processes.
 */

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface JobView {
  jobId: string;
  status: JobStatus;
  percent: number;
  stage: string;
  videoPath: string;
  elapsedMs: number;
  notePath?: string | undefined;
  note?: string | undefined;
  warnings: string;
  error?: string | undefined;
}

export interface StartJobInput {
  videoPath: string;
  preset?: string | undefined;
  outputDir?: string | undefined;
  formats?: ('md' | 'json' | 'html')[] | undefined;
}

interface JobState {
  jobId: string;
  status: JobStatus;
  percent: number;
  stage: string;
  videoPath: string;
  preset: string | undefined;
  outputDir: string | undefined;
  formats: ('md' | 'json' | 'html')[] | undefined;
  createdAt: number;
  startedAt: number | undefined;
  finishedAt: number | undefined;
  output: AnalyzeVideoOutput | undefined;
  error: string | undefined;
  done: Promise<void>;
  settle: () => void;
}

const NOTE_PREVIEW_LIMIT = 20000;

export class JobRegistry {
  private readonly _jobs = new Map<string, JobState>();
  private readonly _queue: string[] = [];
  private _running = 0;
  private _closed = false;

  constructor(
    private readonly _getServices: () => Services,
    private readonly _maxConcurrent: number = 2
  ) {}

  /** Queue a job and return its id immediately. */
  start(input: StartJobInput): string {
    if (this._closed) throw new Error('video-to-notes is shutting down; no new jobs accepted');

    const jobId = randomUUID();
    let settle: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });

    this._jobs.set(jobId, {
      jobId,
      status: 'queued',
      percent: 0,
      stage: 'queued',
      videoPath: input.videoPath,
      preset: input.preset,
      outputDir: input.outputDir,
      formats: input.formats,
      createdAt: Date.now(),
      startedAt: undefined,
      finishedAt: undefined,
      output: undefined,
      error: undefined,
      done,
      settle,
    });

    this._queue.push(jobId);
    this.pump();
    return jobId;
  }

  get(jobId: string): JobView | null {
    const job = this._jobs.get(jobId);
    return job === undefined ? null : toView(job);
  }

  list(): JobView[] {
    return [...this._jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(toView);
  }

  /** Wait for a job to settle (or for the timeout). Returns the final view. */
  async wait(jobId: string, timeoutMs = 0): Promise<JobView | null> {
    const job = this._jobs.get(jobId);
    if (job === undefined) return null;

    if (timeoutMs <= 0) {
      await job.done;
    } else {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      });
      await Promise.race([job.done, timeout]);
      if (timer !== undefined) clearTimeout(timer);
    }
    return toView(job);
  }

  private pump(): void {
    while (!this._closed && this._running < this._maxConcurrent && this._queue.length > 0) {
      const jobId = this._queue.shift();
      if (jobId === undefined) break;
      const job = this._jobs.get(jobId);
      if (job === undefined) continue;

      this._running += 1;
      void this.run(job).finally(() => {
        this._running -= 1;
        this.pump();
      });
    }
  }

  private async run(job: JobState): Promise<void> {
    job.status = 'running';
    job.stage = 'starting';
    job.startedAt = Date.now();

    try {
      const services = this._getServices();
      await services.init();

      const context = services.createContext(job.jobId);
      const output = await services.analyzeVideo.execute(
        {
          videoPath: job.videoPath,
          outputDir: job.outputDir ?? services.defaultOutputDir,
          config: this.resolveConfig(services, job.preset),
          ...(job.formats !== undefined ? { formats: job.formats } : {}),
          progressCallback: (progress: ProgressUpdate) => {
            job.percent = progress.percent;
            job.stage = progress.stage;
          },
        },
        context
      );

      job.output = output;
      job.percent = 100;
      job.stage = 'done';
      job.status = 'completed';
    } catch (error) {
      job.status = 'failed';
      job.stage = 'failed';
      job.error = error instanceof Error ? error.message : String(error);
    } finally {
      job.finishedAt = Date.now();
      job.settle();
    }
  }

  private resolveConfig(services: Services, preset: string | undefined): Partial<ProcessingConfig> | undefined {
    if (preset === undefined || preset.length === 0) return undefined;

    const resolved = services.config.getPresetConfig(preset);
    return {
      frameExtraction: resolved.frameExtraction,
      ocr: resolved.ocr,
      transcription: resolved.transcription,
      note: resolved.note,
    };
  }

  /** Stop accepting work and drop finished job records. */
  dispose(): void {
    this._closed = true;
    this._queue.length = 0;
    this._jobs.clear();
  }
}

function toView(job: JobState): JobView {
  const end = job.finishedAt ?? Date.now();
  const start = job.startedAt ?? job.createdAt;
  const output = job.output;

  const view: JobView = {
    jobId: job.jobId,
    status: job.status,
    percent: job.percent,
    stage: job.stage,
    videoPath: job.videoPath,
    elapsedMs: Math.max(0, end - start),
    warnings: output !== undefined ? output.warnings.join('; ') : '',
  };

  if (output !== undefined) {
    const first = output.outputFiles[0];
    if (first !== undefined) view.notePath = first;
    view.note = previewNote(output);
  }
  if (job.error !== undefined) view.error = job.error;
  return view;
}

function previewNote(output: AnalyzeVideoOutput): string {
  const markdown = output.note.toMarkdown();
  if (markdown.length <= NOTE_PREVIEW_LIMIT) return markdown;
  return `${markdown.slice(0, NOTE_PREVIEW_LIMIT)}\n\n<!-- note truncated; read the file on disk for the full document -->`;
}
